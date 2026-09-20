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
  let historyPanel = null;
  let previewPanel = null;

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
    targetElement = findBestTargetElement(centerX, centerY, selection);
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
    const historyButton = document.createElement('button');
    historyButton.type = 'button';
    historyButton.textContent = 'History';
    Object.assign(historyButton.style, {
      border: '1px solid #1f8fa0', borderRadius: '5px', padding: '4px 7px',
      background: '#0d2b38', color: '#baf7fb', cursor: 'pointer', font: 'inherit',
    });
    historyButton.addEventListener('click', () => showHistory(selector, feedback));
    inputBar.append(badge, input, historyButton, feedback);
    root.append(inputBar);
    input.focus();

    inputBar.addEventListener('submit', (event) => {
      event.preventDefault();
      const prompt = input.value.trim();
      if (!prompt) return;
      feedback.textContent = 'Generating review…';
      sendMutation({
        type: 'MUTATE_REQUEST',
        filePath: metadata?.filePath || null,
        lineNumber: metadata?.lineNumber || null,
        componentName: metadata?.componentName || null,
        prompt,
        selector,
        classNames: [...targetElement.classList],
        computedStyle: getStyleSummary(targetElement),
      }, (message) => {
        if (message.type === 'PREVIEW') {
          feedback.textContent = 'Review changes';
          renderPreview(message, feedback);
        } else if (message.status === 'SUCCESS') feedback.textContent = '✓ HMR triggered';
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
    historyPanel?.remove();
    historyPanel = null;
    previewPanel?.remove();
    previewPanel = null;
  }

  function renderPreview(preview, feedback) {
    previewPanel?.remove();
    previewPanel = document.createElement('div');
    const previewPosition = panelPosition(320);
    Object.assign(previewPanel.style, {
      position: 'fixed', left: `${previewPosition.left}px`, top: `${previewPosition.top}px`,
      width: 'min(620px, calc(100vw - 16px))', maxHeight: '320px', overflow: 'auto', padding: '10px',
      border: '1px solid #00f2fe', borderRadius: '8px', background: 'rgba(4, 16, 25, .98)', color: '#dffcff',
      font: '12px/1.35 ui-monospace, SFMono-Regular, monospace', pointerEvents: 'auto',
    });
    const title = document.createElement('div');
    title.textContent = `Review changes · ${preview.summary || 'Proposed change'}`;
    title.style.cssText = 'margin-bottom:8px;font-family:system-ui,sans-serif;font-weight:700;color:#baf7fb';
    const diff = document.createElement('pre');
    diff.textContent = preview.patches.map((patch) => patch.diff).join('\n\n');
    diff.style.cssText = 'margin:0 0 10px;white-space:pre-wrap;max-height:190px;overflow:auto';
    const apply = document.createElement('button');
    apply.textContent = 'Apply changes';
    apply.style.cssText = 'margin-right:8px;padding:6px 9px;border:0;border-radius:5px;background:#00f2fe;color:#04202a;font-weight:700;cursor:pointer';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.cssText = 'padding:6px 9px;border:1px solid #39707d;border-radius:5px;background:transparent;color:#dffcff;cursor:pointer';
    apply.addEventListener('click', () => {
      feedback.textContent = 'Applying…';
      sendMutation({ type: 'APPLY_REQUEST', previewId: preview.previewId }, (message) => {
        feedback.textContent = message.status === 'SUCCESS' ? '✓ HMR triggered' : `⚠ ${message.message || 'Apply failed'}`;
        if (message.status === 'SUCCESS') previewPanel?.remove();
      });
    });
    cancel.addEventListener('click', () => { previewPanel?.remove(); feedback.textContent = 'Cancelled'; });
    previewPanel.append(title, diff, apply, cancel);
    root.append(previewPanel);
  }

  function showHistory(selector, feedback) {
    feedback.textContent = 'Loading history…';
    sendMutation({
      type: 'HISTORY_LIST', filePath: metadata?.filePath || null,
      componentName: metadata?.componentName || null, selector,
    }, (message) => {
      if (message.type !== 'HISTORY') {
        feedback.textContent = `⚠ ${message.message || 'Could not load history'}`;
        return;
      }
      feedback.textContent = `${message.entries.length} revision${message.entries.length === 1 ? '' : 's'}`;
      renderHistory(message.entries, feedback);
    });
  }

  function renderHistory(entries, feedback) {
    historyPanel?.remove();
    historyPanel = document.createElement('div');
    const historyPosition = panelPosition(220);
    Object.assign(historyPanel.style, {
      position: 'fixed', left: `${historyPosition.left}px`, top: `${historyPosition.top}px`,
      width: 'min(520px, calc(100vw - 16px))', maxHeight: '220px', overflowY: 'auto',
      padding: '8px', border: '1px solid #00f2fe', borderRadius: '8px', background: 'rgba(4, 16, 25, .98)',
      color: '#dffcff', font: '12px/1.3 system-ui, sans-serif', pointerEvents: 'auto', zIndex: '1',
    });
    if (!entries.length) {
      historyPanel.textContent = 'No saved revisions for this component yet.';
    } else {
      entries.forEach((entry) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.textContent = `${new Date(entry.createdAt).toLocaleTimeString()} · ${entry.prompt}`;
        Object.assign(row.style, {
          display: 'block', width: '100%', margin: '3px 0', padding: '7px', border: '1px solid #255563',
          borderRadius: '5px', background: '#0d2b38', color: '#dffcff', cursor: 'pointer', textAlign: 'left', font: 'inherit',
        });
        row.addEventListener('click', () => {
          if (!window.confirm('Restore this revision? The current component file will be backed up first.')) return;
          feedback.textContent = 'Restoring…';
          sendMutation({ type: 'ROLLBACK_REQUEST', revisionId: entry.id }, (message) => {
            feedback.textContent = message.status === 'SUCCESS' ? '✓ Revision restored' : `⚠ ${message.message || 'Restore failed'}`;
            if (message.status === 'SUCCESS') historyPanel?.remove();
          });
        });
        historyPanel.append(row);
      });
    }
    root.append(historyPanel);
  }

  function panelPosition(panelHeight) {
    const margin = 8;
    const preferredTop = selection.y + selection.height + margin;
    const fitsBelow = preferredTop + panelHeight <= window.innerHeight - margin;
    return {
      left: Math.max(margin, Math.min(selection.x, window.innerWidth - 628)),
      top: fitsBelow ? preferredTop : Math.max(margin, selection.y - panelHeight - margin),
    };
  }

  return {
    destroy() {
      window.removeEventListener('resize', resize);
      root.remove();
    },
  };
}

function findBestTargetElement(centerX, centerY, selection) {
  const inset = 12;
  const samplePoints = [
    [centerX, centerY],
    [selection.x + inset, selection.y + inset],
    [selection.x + selection.width - inset, selection.y + inset],
    [selection.x + inset, selection.y + selection.height - inset],
    [selection.x + selection.width - inset, selection.y + selection.height - inset],
  ];
  const selectionArea = Math.max(1, selection.width * selection.height);
  const candidates = new Set();

  samplePoints.forEach(([x, y]) => {
    const element = document.elementFromPoint(x, y);
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      candidates.add(node);
    }
  });

  return [...candidates].sort((first, second) => scoreTarget(second, selectionArea) - scoreTarget(first, selectionArea))[0] || null;
}

function scoreTarget(element, selectionArea) {
  const rect = element.getBoundingClientRect();
  const area = Math.max(1, rect.width * rect.height);
  const hasSource = element.hasAttribute('data-source') || element.hasAttribute('data-inspector-line');
  const isBody = element === document.body || element === document.documentElement;
  // Prefer source-mapped elements whose visible area best matches the drawn box.
  return (hasSource ? 10_000 : 0) - Math.abs(Math.log(area / selectionArea)) * 100 - (isBody ? 500 : 0);
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

function getStyleSummary(element) {
  const style = getComputedStyle(element);
  return Object.fromEntries(['display', 'position', 'width', 'maxWidth', 'padding', 'margin', 'gap', 'fontSize', 'color', 'backgroundColor', 'borderRadius']
    .map((property) => [property, style[property]]));
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
