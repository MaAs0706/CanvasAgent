/**
 * Inspect a DOM node rendered by React and return source-oriented metadata.
 *
 * Usage:
 *   const node = document.elementFromPoint(x, y);
 *   const info = getReactFiberInfo(node);
 */

const REACT_FIBER_KEY = /^(?:__reactFiber\$|__reactInternalInstance\$)/;
const MAX_PROP_DEPTH = 4;

/**
 * @param {Element | null | undefined} domNode A node returned by elementFromPoint.
 * @returns {{componentName: string | null, filePath: string | null, lineNumber: number | null, memoizedProps: object | null}}
 */
export function getReactFiberInfo(domNode) {
  if (!domNode || domNode.nodeType !== Node.ELEMENT_NODE) {
    return emptyInfo();
  }

  const attributeFallback = readSourceAttributes(domNode);
  const fiber = findFiberOnDomPath(domNode);

  if (!fiber) {
    return {
      componentName: attributeFallback.componentName,
      filePath: attributeFallback.filePath,
      lineNumber: attributeFallback.lineNumber,
      memoizedProps: null,
    };
  }

  const componentFiber = findNearestNamedComponent(fiber) || fiber;
  const source = componentFiber._debugSource || fiber._debugSource || null;
  const props = componentFiber.memoizedProps ?? fiber.memoizedProps ?? null;

  return {
    componentName: getComponentName(componentFiber) || attributeFallback.componentName,
    filePath: source?.fileName || attributeFallback.filePath,
    lineNumber: toLineNumber(source?.lineNumber) || attributeFallback.lineNumber,
    memoizedProps: makeJsonSafe(props),
  };
}

function emptyInfo() {
  return { componentName: null, filePath: null, lineNumber: null, memoizedProps: null };
}

function findFiberOnDomPath(startNode) {
  // A click may land on a plain child inserted below React's host element.
  for (let node = startNode; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
    for (const key of Object.keys(node)) {
      if (REACT_FIBER_KEY.test(key) && node[key]) return node[key];
    }
  }
  return null;
}

function findNearestNamedComponent(startFiber) {
  for (let fiber = startFiber; fiber; fiber = fiber.return) {
    if (getComponentName(fiber)) return fiber;
  }
  return null;
}

function getComponentName(fiber) {
  const type = fiber?.elementType || fiber?.type;
  if (typeof type === 'string') return null; // Host DOM components such as div.

  if (typeof type === 'function') {
    return type.displayName || type.name || null;
  }

  if (type && typeof type === 'object') {
    return type.displayName || type.type?.displayName || type.type?.name || null;
  }

  return fiber?._debugOwner ? getComponentName(fiber._debugOwner) : null;
}

function readSourceAttributes(startNode) {
  for (let node = startNode; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
    const source = node.getAttribute('data-source');
    const explicitLine = toLineNumber(node.getAttribute('data-inspector-line'));
    if (source || explicitLine) {
      const parsed = parseSource(source);
      return {
        componentName: node.getAttribute('data-component-name') || null,
        filePath: parsed.filePath,
        lineNumber: explicitLine || parsed.lineNumber,
      };
    }
  }
  return { componentName: null, filePath: null, lineNumber: null };
}

function parseSource(value) {
  if (!value) return { filePath: null, lineNumber: null };

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      return {
        filePath: parsed.fileName || parsed.filePath || null,
        lineNumber: toLineNumber(parsed.lineNumber || parsed.line),
      };
    }
  } catch (_) {
    // Common transforms encode source as "path/to/file.tsx:42[:column]".
  }

  const match = value.match(/^(.*):(\d+)(?::\d+)?$/);
  return match
    ? { filePath: match[1] || null, lineNumber: toLineNumber(match[2]) }
    : { filePath: value, lineNumber: null };
}

function toLineNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function makeJsonSafe(value, depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (depth >= MAX_PROP_DEPTH) return '[truncated]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => makeJsonSafe(item, depth + 1, seen));
  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    safe[key] = makeJsonSafe(item, depth + 1, seen);
  }
  return safe;
}
