import {
  getProfile,
  getPropertyNS,
  setPropertyNS,
  signIn,
  signOut,
} from 'https://auth.api.apphor.de/index.mjs';

const app = document.querySelector('#app');
const propertyName = 'servers';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, className, onClick, icon, primary = true) {
  const baseClass = primary
    ? 'rounded bg-emerald-300 px-2 py-1 font-semi text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50'
    : 'rounded border border-slate-600 bg-slate-800 px-2 py-1 font-semi text-slate-200 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50';
  const node = element('button', undefined, `${baseClass} ${className || ''}`);
  node.type = 'button';
  if (icon) {
    const iconElement = document.createElement('lucide-icon');
    iconElement.setAttribute('icon', icon);
    iconElement.setAttribute('size', '16');
    iconElement.className = 'sm:hidden';
    iconElement.setAttribute('aria-hidden', 'true');
    node.append(iconElement, element('span', text, 'hidden sm:inline'));
    node.setAttribute('aria-label', text);
    node.title = text;
  } else {
    node.textContent = text;
  }
  node.addEventListener('click', onClick);
  return node;
}

function readServers(value) {
  if (!value) return [];
  if (typeof value === 'object' && value.value !== undefined) value = value.value;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((server) => server?.endpoint && server?.key) : [];
  } catch {
    return [];
  }
}

function validateEndpoint(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function renderSignedOut() {
  app.replaceChildren();
  const header = element('header', undefined, 'mb-6 flex items-start justify-between gap-4');
  const title = element('div');
  title.append(element('h1', 'xterm', 'text-4xl font-black tracking-tighter sm:text-5xl'));
  header.append(title);
  const panel = element('section', undefined, 'grid gap-4 rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-2xl');
  panel.append(element('h2', 'Sign in to continue', 'text-lg font-semibold'), element('p', 'Your server list and keys are stored privately with your auth account.', 'text-slate-400'));
  panel.append(button('Sign in', 'text-slate-950', () => signIn(false)));
  app.append(header, panel);
}

async function saveServers(servers) {
  await setPropertyNS(propertyName, JSON.stringify(servers));
}

function renderSignedIn(profile, initialServers) {
  let servers = initialServers;
  app.replaceChildren();

  const header = element('header', undefined, 'mb-6 flex items-center justify-between gap-4');
  const title = element('div');
  title.append(element('h1', 'xterm', 'text-4xl font-black tracking-tighter sm:text-5xl'));
  const account = element('div', '', 'flex items-center gap-3');
  if (profile.photo) {
    const avatar = element('img', '', 'h-8 w-8 rounded-full object-cover');
    avatar.src = profile.photo;
    avatar.alt = '';
    account.append(avatar);
  }
  account.append(element('span', profile.name || profile.displayName || profile.email || 'Account', 'hidden text-sm text-slate-300 sm:inline'));
  account.append(button('Sign out', 'hover:text-white', async () => { await signOut(); renderSignedOut(); }, undefined, false));
  header.append(title, account);

  const listPanel = element('section', undefined, 'overflow-hidden rounded-xl border border-slate-700 bg-slate-900/80 shadow-xl');
  const heading = element('div', undefined, 'flex items-baseline justify-between gap-4 border-b border-slate-700 px-4 py-3');
  heading.append(element('h2', 'Your servers', 'font-semibold'), element('span', `${servers.length} saved`, 'text-xs text-slate-400'));
  const tableWrap = element('div', undefined, 'overflow-x-auto');
  const table = element('table', undefined, 'w-full text-left text-sm');
  const thead = element('thead', undefined, 'bg-slate-800/70 text-xs uppercase tracking-wide text-slate-400');
  const headRow = element('tr');
  headRow.append(element('th', 'Endpoint', 'px-4 py-2 font-medium'), element('th', 'Actions', 'px-4 py-2 text-right font-medium'));
  thead.append(headRow);
  const list = element('tbody');

  function renderList() {
    list.replaceChildren();
    heading.lastChild.textContent = `${servers.length} saved`;
    if (!servers.length) {
      const row = element('tr');
      const cell = element('td', 'Add a server below to get started.', 'px-4 py-4 text-slate-400');
      cell.colSpan = 2;
      row.append(cell);
      list.append(row);
      return;
    }
    servers.forEach((server, index) => {
      const row = element('tr', undefined, 'border-t border-slate-800');
      row.append(element('td', server.endpoint, 'break-all px-4 py-3 font-mono text-xs text-slate-200'));
      const actions = element('td', '', 'whitespace-nowrap px-4 py-3 text-right');
      actions.append(button('Connect', '', () => {
        sessionStorage.setItem('xterm.connection', JSON.stringify(server));
        showTerminal(profile, servers);
      }, 'plug-2'));
      actions.append(button('Remove', 'ml-2 border-rose-900 text-rose-300 hover:bg-rose-950', async () => {
        servers = servers.filter((_, itemIndex) => itemIndex !== index);
        await saveServers(servers);
        renderList();
      }, 'trash-2', false));
      row.append(actions);
      list.append(row);
    });
  }
  renderList();
  table.append(thead, list);
  tableWrap.append(table);
  listPanel.append(heading, tableWrap);

  const addPanel = element('section', undefined, 'mt-3 rounded-xl border border-slate-700 bg-slate-900/80 p-4 shadow-xl');
  addPanel.append(element('h2', 'Add a server', 'mb-3 font-semibold'));
  const form = element('form', undefined, 'grid gap-2 sm:grid-cols-[1.2fr_1fr_auto] sm:items-end');
  const endpointLabel = element('label', 'Endpoint', 'grid gap-1 text-xs text-slate-400');
  const endpoint = element('input', undefined, 'w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-300 focus:ring-1 focus:ring-emerald-300');
  endpoint.type = 'url'; endpoint.required = true; endpoint.placeholder = 'wss://server.example/ws';
  endpointLabel.append(endpoint);
  const keyLabel = element('label', 'Auth key', 'grid gap-1 text-xs text-slate-400');
  const key = element('input', undefined, 'w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-300 focus:ring-1 focus:ring-emerald-300');
  key.type = 'password'; key.required = true; key.placeholder = 'Secret key';
  keyLabel.append(key);
  const submit = button('Add server', 'self-end text-slate-950'); submit.type = 'submit';
  const error = element('p', '', 'text-rose-300');
  form.append(endpointLabel, keyLabel, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); error.textContent = '';
    const normalized = validateEndpoint(endpoint.value.trim());
    if (!normalized) { error.textContent = 'Use a valid http(s):// or ws(s):// endpoint.'; return; }
    if (servers.some((server) => server.endpoint === normalized)) { error.textContent = 'That endpoint is already saved.'; return; }
    submit.disabled = true;
    try {
      servers = [...servers, { endpoint: normalized, key: key.value }];
      await saveServers(servers);
      form.reset(); renderList();
    } catch (cause) {
      error.textContent = `Could not save server: ${cause.message}`;
    } finally { submit.disabled = false; }
  });
  addPanel.append(form, error);
  app.append(header, listPanel, addPanel);
}

function showTerminal(profile, servers) {
  app.replaceChildren();
  const shell = element('section', undefined, 'fixed inset-0 flex flex-col bg-black');
  const toolbar = element('div', undefined, 'flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950 px-3 py-2');
  toolbar.append(element('span', 'xterm', 'font-semibold text-slate-200'));
  toolbar.append(button('Back to servers', '', () => renderSignedIn(profile, servers), undefined, false));
  const terminal = document.createElement('x-terminal');
  terminal.className = 'min-h-0 flex-1';
  shell.append(toolbar, terminal);
  app.append(shell);
}

async function start() {
  renderSignedOut();
  try {
    const profile = await getProfile();
    const stored = await getPropertyNS(propertyName);
    renderSignedIn(profile, readServers(stored));
  } catch {
    renderSignedOut();
  }
}

start();
