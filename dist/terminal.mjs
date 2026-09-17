import { ref, hook, templateRef, onInit } from '@li3/web';
import { Terminal } from 'https://unpkg.com/@xterm/xterm@6/lib/xterm.mjs';
import { FitAddon } from 'https://unpkg.com/@xterm/addon-fit@0.11.0/lib/addon-fit.mjs';

function debounce(fn, time) {
  let timer;

  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), time);
  };
}

const autofit = new Set();
window.addEventListener('resize', () => {
  for (const next of autofit) {
    const ref = next.deref();
    if (ref) {
      ref.fit();
    } else {
      autofit.delete(next);
    }
  }
});

export default function () {
  const href = new URL(location.href);
  const [key, setKey] = hook('');
  const [remote, setRemote] = hook(decodeURIComponent(href.searchParams.get('remote')));
  const reconnect = ref(true);
  const online = ref(false);
  const terminalRef = templateRef('terminal');
  const debounceTime = 50;
  const maxBuffer = 5;
  const clientBuffer = [];

  let currentSocket;
  let terminal;
  let fitAddon;

  if (!remote.value) {
    setRemote(prompt('Remote URL'));
  }

  setKey(prompt('Auth key'));

  async function getToken(remote, key) {
    const res = await fetch(new URL('/auth', remote), {
      method: 'POST',
      body: JSON.stringify({ key }),
    });

    const { token } = await res.json();
    return token;
  }

  function sendInput() {
    const data = clientBuffer.join('');
    onSend('input', data);
    clientBuffer.length = 0;
  }

  const sendDelayed = debounce(sendInput, debounceTime);

  function createTerminal() {
    terminal = new Terminal({ convertEol: true });
    terminal.open(terminalRef.value);

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.onData(onClientWrite);
    terminal.onResize(({ cols, rows }) => onSend('resize', { cols, rows }));

    const addOn = new WeakRef(fitAddon);
    autofit.add(addOn);
  }

  function onClientWrite(c) {
    clientBuffer.push(c);

    if (c === '\r' || c === '\t' || clientBuffer.length > maxBuffer) {
      return sendInput();
    }

    sendDelayed();
  }

  function onSend(type, data) {
    if (currentSocket && currentSocket.OPEN === currentSocket.readyState) {
      currentSocket.send(JSON.stringify({ type, data }));
    }
  }

  function onStatusChange(newStatus) {
    online.value = newStatus;

    if (!newStatus && reconnect.value) {
      setTimeout(connect, 5000);
    }

    if (newStatus) {
      fitAddon.fit();
    }
  }

  function onClose() {
    reconnect.value = false;

    if (currentSocket) {
      onSend('close');
      currentSocket.close();
    }

    currentSocket = null;
    terminal.write('\n\n');
  }

  function onMessage(message) {
    const event = JSON.parse(message);

    switch (event.type) {
      case 'close':
        onClose();
        break;

      case 'stdout':
        const chunk = event.data;

        if (typeof chunk === 'string') {
          terminal.write(chunk);
          break;
        }

        if (chunk.type === 'Buffer') {
          const buffer = new ArrayBuffer(chunk.data.length);
          const uint8 = new Uint8Array(buffer);
          uint8.set(chunk.data, 0);
          terminal.write(uint8);
        }
        break;
    }
  }

  async function connect() {
    const token = await getToken(remote.value, key.value);
    const url = new URL(remote.value);
    url.searchParams.set('token', token);

    const socket = new WebSocket(url);

    socket.addEventListener('message', (e) => onMessage(e.data));
    socket.addEventListener('close', () => onStatusChange(false));
    socket.addEventListener('open', () => onStatusChange(true));

    currentSocket = socket;
    setTimeout(() => fitAddon.fit(), 1000);
  }

  onInit(() => {
    createTerminal();
    connect();
  });

  function onReconnect() {
    reconnect.value = true;
    terminal.clear();
    connect();
  }

  return { onReconnect, onClose, online, remote, key };
}
