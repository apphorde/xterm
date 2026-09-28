import {
  getProfile,
  getPropertyNS,
  setPropertyNS,
  signIn,
  signOut,
} from 'https://auth.api.apphor.de/index.mjs';

const app = document.querySelector('#app');
const propertyName = 'servers';
const connectionStorageKey = 'xterm.connections';
window.xtermConnections ||= new Map();
navigator.serviceWorker?.register('/sw.js').catch(() => {});

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, className, onClick, icon, primary = true, iconOnly = false) {
  const baseClass = primary
    ? 'rounded bg-emerald-300 px-2 py-1 font-semi text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50'
    : 'rounded border border-slate-600 bg-slate-800 px-2 py-1 font-semi text-slate-200 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50';
  const node = element('button', undefined, `${baseClass} ${className || ''}`);
  node.type = 'button';
  if (icon) {
    const iconElement = document.createElement('lucide-icon');
    iconElement.setAttribute('icon', icon);
    iconElement.setAttribute('size', '16');
    iconElement.className = iconOnly ? '' : 'sm:hidden';
    iconElement.setAttribute('aria-hidden', 'true');
    if (iconOnly) node.append(iconElement);
    else node.append(iconElement, element('span', text, 'hidden sm:inline'));
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

function readConnections(servers) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(connectionStorageKey) || '[]');
    return Array.isArray(saved)
      ? saved.map((item) => ({
        id: item.id,
        server: servers.find((server) => server.endpoint === item.endpoint),
      })).filter((item) => item.id && item.server)
      : [];
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
  panel.append(button('Sign in', 'w-fit text-slate-950 shadow-lg shadow-emerald-950/30', () => signIn(false)));
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
      const endpointCell = element('td', undefined, 'px-4 py-3');
      const endpoint = element('span', server.nickname || server.endpoint, 'break-all font-mono text-xs text-slate-200');
      endpointCell.append(endpoint);
      row.append(endpointCell);
      const actions = element('td', '', 'whitespace-nowrap px-4 py-3 text-right');
      actions.append(button('Connect', '', () => {
        showTerminalWorkspace(profile, servers, server);
      }, 'plug-2'));
      actions.append(button('Remove', 'ml-2 border-rose-900 text-rose-300 hover:bg-rose-950', async () => {
        servers = servers.filter((_, itemIndex) => itemIndex !== index);
        await saveServers(servers);
        renderList();
      }, 'trash', false));
      actions.append(button('Edit', 'ml-2', () => editServer(row, server, renderList, servers), 'pencil', false));
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
  const form = element('form', undefined, 'grid gap-2 sm:grid-cols-[1fr_1.5fr_1fr_auto] sm:items-end');
  const nicknameLabel = element('label', 'Nickname', 'grid gap-1 text-xs text-slate-400');
  const nickname = element('input', undefined, 'w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-300 focus:ring-1 focus:ring-emerald-300');
  nickname.type = 'text'; nickname.required = true; nickname.placeholder = 'Office server';
  nicknameLabel.append(nickname);
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
  form.append(nicknameLabel, endpointLabel, keyLabel, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); error.textContent = '';
    const normalized = validateEndpoint(endpoint.value.trim());
    if (!normalized) { error.textContent = 'Use a valid http(s):// or ws(s):// endpoint.'; return; }
    if (servers.some((server) => server.endpoint === normalized)) { error.textContent = 'That endpoint is already saved.'; return; }
    submit.disabled = true;
    try {
      servers = [...servers, { nickname: nickname.value.trim() || normalized, endpoint: normalized, key: key.value }];
      await saveServers(servers);
      form.reset(); renderList();
    } catch (cause) {
      error.textContent = `Could not save server: ${cause.message}`;
    } finally { submit.disabled = false; }
  });
  addPanel.append(form, error);
  app.append(header, listPanel, addPanel);
}

function showTerminalWorkspace(profile, servers, firstServer, restored = []) {
  app.replaceChildren();
  const shell = element('section', undefined, 'fixed inset-0 flex flex-col bg-black');
  const toolbar = element('div', undefined, 'flex shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-950 px-3 py-2');
  toolbar.append(element('span', 'xterm', 'font-semibold text-slate-200'));
  const workspace = { profile, servers, sessions: [], tabs: null, panels: null };
  const tabs = element('nav', undefined, 'flex min-w-0 flex-1 gap-1 overflow-x-auto');
  const add = button('New connection', '', () => openConnectionDialog(workspace), 'plus', false, true);
  add.classList.add('shrink-0');
  toolbar.append(tabs, add);
  const panels = element('div', undefined, 'min-h-0 flex-1');
  workspace.tabs = tabs;
  workspace.panels = panels;

  function activate(id) {
    for (const session of workspace.sessions) {
      const active = session.id === id;
      session.panel.classList.toggle('hidden', !active);
      session.tab.className = active
        ? 'shrink-0 rounded bg-slate-700 px-3 py-1 text-xs text-white'
        : 'shrink-0 rounded px-3 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white';
    }
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  workspace.persist = () => sessionStorage.setItem(connectionStorageKey, JSON.stringify(workspace.sessions.map(({ id, server }) => ({ id, endpoint: server.endpoint }))));
  workspace.addSession = (server, restoredId) => {
    const id = restoredId || crypto.randomUUID();
    window.xtermConnections.set(id, server);
    const tab = element('button', server.nickname || server.endpoint, 'shrink-0 rounded px-3 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white');
    tab.type = 'button';
    const panel = element('div', undefined, 'hidden h-full min-h-0');
    const terminal = document.createElement('x-terminal');
    terminal.setAttribute('connectionId', id);
    terminal.className = 'block h-full min-h-0';
    tab.addEventListener('click', () => activate(id));
    panel.append(terminal);
    tabs.append(tab);
    panels.append(panel);
    workspace.sessions.push({ id, panel, tab, server });
    workspace.persist();
    activate(id);
  };

  window.addEventListener('xterm-closed', (event) => {
    const id = event.detail?.id;
    const session = workspace.sessions.find((item) => item.id === id);
    if (!session) return;
    session.panel.remove();
    session.tab.remove();
    workspace.sessions = workspace.sessions.filter((item) => item.id !== id);
    window.xtermConnections.delete(id);
    workspace.persist();
    if (workspace.sessions.length) workspace.sessions.at(-1).tab.click();
  });

  shell.append(toolbar, panels);
  app.append(shell);
  const sessions = restored.length ? restored : [{ server: firstServer }];
  for (const session of sessions) workspace.addSession(session.server, session.id);
}

function editServer(row, server, renderList, servers) {
  const cell = row.firstChild;
  cell.replaceChildren();
  const fields = element('div', undefined, 'grid gap-2 sm:grid-cols-2');
  const nickname = element('input', undefined, 'w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-100');
  nickname.value = server.nickname || server.endpoint;
  const endpoint = element('input', undefined, 'w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100');
  endpoint.value = server.endpoint;
  fields.append(nickname, endpoint);
  cell.append(fields);
  const actions = row.lastChild;
  actions.replaceChildren();
  actions.append(button('Save', '', async () => {
    const normalized = validateEndpoint(endpoint.value.trim());
    if (!normalized || !nickname.value.trim()) return;
    server.endpoint = normalized;
    server.nickname = nickname.value.trim();
    await saveServers(servers);
    renderList();
  }));
  actions.append(button('Cancel', 'ml-2', renderList, undefined, false));
}

function openConnectionDialog(workspace) {
  const overlay = element('div', undefined, 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const dialog = element('div', undefined, 'w-full max-w-xl overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl');
  const heading = element('div', undefined, 'flex items-center justify-between border-b border-slate-700 px-4 py-3');
  heading.append(element('h2', 'Open a connection', 'font-semibold'));
  heading.append(button('Close', '', () => overlay.remove(), 'x', false));
  const list = element('div', undefined, 'max-h-[60vh] overflow-y-auto p-2');
  if (!workspace.servers.length) {
    list.append(element('p', 'No saved servers are available.', 'p-3 text-sm text-slate-400'));
  } else {
    for (const server of workspace.servers) {
      const row = element('div', undefined, 'flex items-center justify-between gap-3 rounded px-3 py-2 hover:bg-slate-800');
      row.append(element('span', server.nickname || server.endpoint, 'break-all text-xs text-slate-200'));
      row.append(button('Connect', 'text-xs', () => {
        overlay.remove();
        workspace.addSession(server);
      }, 'plug-2'));
      list.append(row);
    }
  }
  dialog.append(heading, list);
  overlay.append(dialog);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  document.body.append(overlay);
}

async function start() {
  renderSignedOut();
  try {
    const profile = await getProfile();
    const stored = await getPropertyNS(propertyName);
    const servers = readServers(stored);
    const restored = readConnections(servers);
    if (restored.length) showTerminalWorkspace(profile, servers, restored[0].server, restored);
    else renderSignedIn(profile, servers);
  } catch {
    renderSignedOut();
  }
}

start();
