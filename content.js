let getReactFiberInfo = () => ({
  componentName: null,
  filePath: null,
  lineNumber: null,
  memoizedProps: null,
});

// Content scripts are not static ES modules, so load the standalone inspector
// dynamically from the extension package.
import(chrome.runtime.getURL('reactFiberInspector.js'))
  .then((module) => {
    getReactFiberInfo = module.getReactFiberInfo;
  })
  .catch((error) => console.warn('[Viewport HUD] React inspector unavailable.', error));

const HUD_ROOT_ID = 'viewport-hud-root';
const SOCKET_URL = 'ws://localhost:8080';
let hud = null;
let socket = null;
let pendingMutationListener = null;

console.info('[Viewport HUD] Content script loaded.', window.location.href);

document.addEventListener('keydown', (event) => {
  // On macOS, Option+A may produce "å" for event.key. event.code identifies
  // the physical A key regardless of keyboard layout or modifier output.
  if (event.altKey && event.code === 'KeyA' && !isTextInput(event.target)) {
    event.preventDefault();
    console.info('[Viewport HUD] Shortcut received.');
    toggleHud();
  }
}, true);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'VIEWPORT_HUD_TOGGLE') toggleHud();
});

function toggleHud() {
  if (hud) {
    hud.destroy();
    hud = null;
    console.info('[Viewport HUD] Overlay closed.');
    return;
  }
  hud = createHud();
  console.info('[Viewport HUD] Overlay opened.');
}

function createHud() {
  const root = document.createElement('div');
  root.id = HUD_ROOT_ID;
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none',
  });

  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    cursor: 'crosshair', pointerEvents: 'auto',
  });
  root.append(canvas);
  document.documentElement.append(root);

  const context = canvas.getContext('2d');
  let start = null;
  let selection = null;
  let targetElement = null;
  let metadata = null;
  let inputBar = null;

  const resize = () => {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    redraw(selection);
  };

  const getPoint = (event) => ({ x: event.clientX, y: event.clientY });

  canvas.addEventListener('mousedown', (event) => {
    start = getPoint(event);
    selection = null;
    removeInputBar();
  });

  canvas.addEventListener('mousemove', (event) => {
    if (!start) return;
    selection = rectangleFrom(start, getPoint(event));
    redraw(selection);
  });

  canvas.addEventListener('mouseup', (event) => {
    if (!start) return;
    selection = rectangleFrom(start, getPoint(event));
    start = null;
    redraw(selection);
    inspectSelection();
  });

  window.addEventListener('resize', resize);
  resize();

  function redraw(rectangle) {
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (!rectangle || rectangle.width < 1 || rectangle.height < 1) return;

    context.save();
    context.strokeStyle = '#00f2fe';
    context.lineWidth = 2;
    context.shadowColor = '#00f2fe';
    context.shadowBlur = 15;
    context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
    context.restore();
  }

  function inspectSelection() {
    if (!selection) return;
    const centerX = selection.x + selection.width / 2;
    const centerY = selection.y + selection.height / 2;

    canvas.style.pointerEvents = 'none';
    targetElement = document.elementFromPoint(centerX, centerY);
    canvas.style.pointerEvents = 'auto';

    if (!targetElement || targetElement.closest(`#${HUD_ROOT_ID}`)) return;
    metadata = getReactFiberInfo(targetElement);
    showInputBar();
  }

  function showInputBar() {
    removeInputBar();
    inputBar = document.createElement('form');
    const selector = cssSelector(targetElement);
    const source = metadata?.filePath && metadata?.lineNumber
      ? `${metadata.filePath}:${metadata.lineNumber}`
      : selector;
    const label = metadata?.componentName
      ? `${metadata.componentName} · ${source}`
      : source;

    Object.assign(inputBar.style, {
      position: 'fixed', left: `${Math.max(8, selection.x)}px`,
      top: `${Math.max(8, selection.y - 54)}px`, display: 'flex', alignItems: 'center', gap: '8px',
      maxWidth: 'calc(100vw - 16px)', padding: '8px 10px', border: '1px solid #00f2fe',
      borderRadius: '8px', background: 'rgba(4, 16, 25, 0.96)', boxShadow: '0 0 15px #00f2fe',
      color: '#dffcff', font: '12px/1.2 system-ui, sans-serif', pointerEvents: 'auto',
    });

    const badge = document.createElement('span');
    badge.textContent = label;
    Object.assign(badge.style, { maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Describe code or style modification...';
    Object.assign(input.style, {
      width: 'min(360px, 42vw)', border: '0', outline: '0', color: '#fff',
      background: 'transparent', font: 'inherit',
    });
    const feedback = document.createElement('span');
    Object.assign(feedback.style, { color: '#9ceff4', whiteSpace: 'nowrap' });
    inputBar.append(badge, input, feedback);
    root.append(inputBar);
    input.focus();

    inputBar.addEventListener('submit', (event) => {
      event.preventDefault();
      const prompt = input.value.trim();
      if (!prompt) return;
      feedback.textContent = 'Sending…';
      sendMutation({
        type: 'MUTATE_REQUEST',
        filePath: metadata?.filePath || null,
        lineNumber: metadata?.lineNumber || null,
        componentName: metadata?.componentName || null,
        prompt,
        selector,
      }, (message) => {
        if (message.status === 'SUCCESS') feedback.textContent = '✓ HMR triggered';
        else if (message.status === 'FALLBACK_CSS') feedback.textContent = '↗ CSS preview applied';
        else feedback.textContent = `⚠ ${message.message || 'Request failed'}`;
        if (message.status === 'FALLBACK_CSS') applyCssPreview(targetElement, message.css);
      });
      applyImmediateFeedback(targetElement);
      input.value = '';
    });
  }

  function removeInputBar() {
    inputBar?.remove();
    inputBar = null;
  }

  return {
    destroy() {
      window.removeEventListener('resize', resize);
      root.remove();
    },
  };
}

function rectangleFrom(start, end) {
  return {
    x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y),
  };
}

function sendMutation(payload, onStatus) {
  pendingMutationListener = onStatus;
  if (!socket || socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
    socket = new WebSocket(SOCKET_URL);
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.status !== 'CONNECTED') pendingMutationListener?.(message);
      } catch (_) {
        pendingMutationListener?.({ status: 'ERROR', message: 'Invalid bridge response.' });
      }
    });
    socket.addEventListener('error', () => {
      pendingMutationListener?.({ status: 'ERROR', message: 'Local bridge is unavailable.' });
    });
  }
  const send = () => socket.send(JSON.stringify(payload));
  if (socket.readyState === WebSocket.OPEN) send();
  else socket.addEventListener('open', send, { once: true });
}

function applyImmediateFeedback(element) {
  // The bridge will apply the actual requested change; this makes selection feel instant.
  setTimeout(() => {
    Object.assign(element.style, {
      transition: 'outline-color 120ms ease, box-shadow 120ms ease',
      outline: '2px solid #00f2fe', boxShadow: '0 0 15px rgba(0, 242, 254, 0.8)',
    });
  }, 10);
}

function applyCssPreview(element, cssText) {
  if (!cssText) return;
  cssText.split(';').forEach((declaration) => {
    const [property, value] = declaration.split(':').map((part) => part?.trim());
    if (property && value) element.style.setProperty(property, value);
  });
}

function cssSelector(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
  if (element.id) return `#${CSS.escape(element.id)}`;
  const path = [];
  for (let node = element; node && node !== document.body; node = node.parentElement) {
    let part = node.tagName.toLowerCase();
    if (node.classList.length) part += `.${CSS.escape(node.classList[0])}`;
    const peers = [...node.parentElement?.children || []].filter((child) => child.tagName === node.tagName);
    if (peers.length > 1) part += `:nth-of-type(${peers.indexOf(node) + 1})`;
    path.unshift(part);
  }
  return path.join(' > ');
}

function isTextInput(element) {
  return element?.matches?.('input, textarea, select, [contenteditable="true"]');
}
