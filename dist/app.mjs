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
  const node = element('button', text, className);
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
  const header = element('header');
  const title = element('div');
  title.append(element('h1', 'xterm'));
  header.append(title);
  const panel = element('section', undefined, 'panel');
  panel.append(element('h2', 'Sign in to continue'), element('p', 'Your server list and keys are stored privately with your auth account.', 'muted'));
  panel.append(button('Sign in', '', () => signIn(false)));
  app.append(header, panel);
}

async function saveServers(servers) {
  await setPropertyNS(propertyName, JSON.stringify(servers));
}

function renderSignedIn(profile, initialServers) {
  let servers = initialServers;
  app.replaceChildren();

  const header = element('header');
  const title = element('div');
  title.append(element('h1', 'xterm'));
  const account = element('div', '');
  account.className = 'profile';
  if (profile.photo) {
    const avatar = element('img', '', 'avatar');
    avatar.src = profile.photo;
    avatar.alt = '';
    account.append(avatar);
  }
  account.append(element('span', profile.name || profile.displayName || profile.email || 'Account'));
  account.append(button('Sign out', 'secondary', async () => { await signOut(); renderSignedOut(); }));
  header.append(title, account);

  const listPanel = element('section', undefined, 'panel');
  const heading = element('div', undefined, 'section-heading');
  heading.append(element('h2', 'Your servers'), element('span', `${servers.length} saved`, 'muted'));
  const list = element('div', undefined, 'server-list');

  function renderList() {
    list.replaceChildren();
    heading.lastChild.textContent = `${servers.length} saved`;
    if (!servers.length) {
      list.append(element('p', 'Add a websocket endpoint below to get started.', 'empty'));
      return;
    }
    servers.forEach((server, index) => {
      const row = element('div', undefined, 'server');
      row.append(element('span', server.endpoint, 'server-endpoint'));
      const actions = element('div');
      actions.append(button('Connect', '', () => {
        sessionStorage.setItem('xterm.connection', JSON.stringify(server));
        location.href = '/terminal-page.html';
      }));
      actions.append(button('Remove', 'secondary danger', async () => {
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

  const addPanel = element('section', undefined, 'panel');
  addPanel.append(element('h2', 'Add a server'));
  const form = element('form');
  const endpointLabel = element('label', 'Endpoint');
  const endpoint = element('input');
  endpoint.type = 'url'; endpoint.required = true; endpoint.placeholder = 'wss://server.example/ws';
  endpointLabel.append(endpoint);
  const keyLabel = element('label', 'Auth key');
  const key = element('input');
  key.type = 'password'; key.required = true; key.placeholder = 'Secret key';
  keyLabel.append(key);
  const submit = element('button', 'Add server'); submit.type = 'submit';
  const error = element('p', '', 'error');
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
