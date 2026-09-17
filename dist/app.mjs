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

function button(text, className, onClick) {
  const baseClass = 'rounded-lg bg-emerald-300 px-4 py-2 font-bold text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50';
  const node = element('button', text, `${baseClass} ${className || ''}`);
  node.type = 'button';
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
  const header = element('header', undefined, 'mb-8 flex items-start justify-between gap-4 sm:mb-12');
  const title = element('div');
  title.append(element('h1', 'xterm', 'text-4xl font-black tracking-tighter sm:text-5xl'));
  header.append(title);
  const panel = element('section', undefined, 'grid gap-4 rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-2xl');
  panel.append(element('h2', 'Sign in to continue', 'text-lg font-semibold'), element('p', 'Your server list and keys are stored privately with your auth account.', 'text-slate-400'));
  panel.append(button('Sign in', '', () => signIn(false)));
  app.append(header, panel);
}

async function saveServers(servers) {
  await setPropertyNS(propertyName, JSON.stringify(servers));
}

function renderSignedIn(profile, initialServers) {
  let servers = initialServers;
  app.replaceChildren();

  const header = element('header', undefined, 'mb-8 flex items-start justify-between gap-4 sm:mb-12');
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
  account.append(button('Sign out', 'border border-slate-600 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white', async () => { await signOut(); renderSignedOut(); }));
  header.append(title, account);

  const listPanel = element('section', undefined, 'grid gap-4 rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-2xl');
  const heading = element('div', undefined, 'flex items-baseline justify-between gap-4');
  heading.append(element('h2', 'Your servers', 'text-lg font-semibold'), element('span', `${servers.length} saved`, 'text-sm text-slate-400'));
  const list = element('div', undefined, 'grid gap-3');

  function renderList() {
    list.replaceChildren();
    heading.lastChild.textContent = `${servers.length} saved`;
    if (!servers.length) {
      list.append(element('p', 'Add a websocket endpoint below to get started.', 'py-2 text-slate-400'));
      return;
    }
    servers.forEach((server, index) => {
      const row = element('div', undefined, 'flex flex-col justify-between gap-3 rounded-xl border border-slate-700 bg-slate-800/80 p-4 sm:flex-row sm:items-center');
      row.append(element('span', server.endpoint, 'break-all font-mono text-sm text-slate-200'));
      const actions = element('div', '');
      actions.className = 'flex shrink-0 gap-2';
      actions.append(button('Connect', '', () => {
        sessionStorage.setItem('xterm.connection', JSON.stringify(server));
        location.href = '/terminal-page.html';
      }));
      actions.append(button('Remove', 'border border-rose-900 bg-transparent text-rose-300 hover:bg-rose-950', async () => {
        servers = servers.filter((_, itemIndex) => itemIndex !== index);
        await saveServers(servers);
        renderList();
      }));
      row.append(actions);
      list.append(row);
    });
  }
  renderList();
  listPanel.append(heading, list);

  const addPanel = element('section', undefined, 'mt-4 grid gap-4 rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-2xl');
  addPanel.append(element('h2', 'Add a server', 'text-lg font-semibold'));
  const form = element('form', undefined, 'grid gap-3 sm:grid-cols-[1.2fr_1fr_auto]');
  const endpointLabel = element('label', 'Endpoint', 'grid gap-2 text-xs text-slate-400');
  const endpoint = element('input', undefined, 'w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-300 focus:ring-1 focus:ring-emerald-300');
  endpoint.type = 'url'; endpoint.required = true; endpoint.placeholder = 'wss://server.example/ws';
  endpointLabel.append(endpoint);
  const keyLabel = element('label', 'Auth key', 'grid gap-2 text-xs text-slate-400');
  const key = element('input', undefined, 'w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-300 focus:ring-1 focus:ring-emerald-300');
  key.type = 'password'; key.required = true; key.placeholder = 'Secret key';
  keyLabel.append(key);
  const submit = button('Add server', 'self-end'); submit.type = 'submit';
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

async function start() {
  try {
    const profile = await getProfile();
    const stored = await getPropertyNS(propertyName);
    renderSignedIn(profile, readServers(stored));
  } catch {
    renderSignedOut();
  }
}

start();
