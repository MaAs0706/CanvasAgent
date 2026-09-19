/**
 * Return React source metadata (when available) for a DOM element.
 *
 * @param {Element | null | undefined} domNode A node from document.elementFromPoint().
 * @returns {{isReact: boolean, componentName: string|null, filePath: string|null, lineNumber: number|null, props: object|null, selector: string|null}}
 */
export function getReactFiberInfo(domNode) {
  const selector = createCssSelector(domNode);
  if (!isElement(domNode)) return createResult(false, null, null, null, null, selector);

  const domSource = readDomSource(domNode);
  const fiber = findFiber(domNode);
  if (!fiber) {
    return createResult(false, domSource.componentName, domSource.filePath, domSource.lineNumber, null, selector);
  }

  const componentFiber = findNearestNamedComponent(fiber);
  const inspectedFiber = componentFiber || fiber;
  const source = findDebugSource(inspectedFiber);
  return createResult(
    true,
    getComponentName(componentFiber) || domSource.componentName,
    source.filePath || domSource.filePath,
    source.lineNumber || domSource.lineNumber,
    makeJsonSafe(inspectedFiber.memoizedProps || null),
    selector,
  );
}

function createResult(isReact, componentName, filePath, lineNumber, props, selector) {
  return { isReact, componentName, filePath, lineNumber, props, selector };
}

function isElement(value) {
  return Boolean(value) && value.nodeType === 1;
}

function findFiber(startNode) {
  // The exact target can be a non-React child inside a React host element.
  for (let node = startNode; isElement(node); node = node.parentElement) {
    for (const key of Object.keys(node)) {
      if (/^(?:__reactFiber\$|__reactInternalInstance\$)/.test(key) && node[key]) return node[key];
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
  const type = fiber?.type;
  if (typeof type === 'function') return type.displayName || type.name || null;
  if (type && typeof type === 'object') {
    // Covers memo() and forwardRef() wrappers.
    return type.displayName || type.type?.displayName || type.type?.name || null;
  }
  return null; // A string type is a host component, e.g. "button".
}

function findDebugSource(startFiber) {
  for (let fiber = startFiber; fiber; fiber = fiber.return) {
    const source = fiber._debugSource || fiber.memoizedProps?._source;
    if (source && typeof source === 'object') {
      const filePath = source.fileName || source.filePath || null;
      const lineNumber = positiveInteger(source.lineNumber || source.line);
      if (filePath || lineNumber) return { filePath, lineNumber };
    }
  }
  return { filePath: null, lineNumber: null };
}

function readDomSource(startNode) {
  for (let node = startNode; isElement(node); node = node.parentElement) {
    const rawSource = node.getAttribute('data-source');
    const explicitLine = positiveInteger(node.getAttribute('data-inspector-line'));
    const componentName = node.getAttribute('data-component') || null;
    if (rawSource || explicitLine || componentName) {
      const parsed = parseSource(rawSource);
      return {
        componentName,
        filePath: parsed.filePath,
        lineNumber: explicitLine || parsed.lineNumber,
      };
    }
  }
  return { componentName: null, filePath: null, lineNumber: null };
}

function parseSource(rawSource) {
  if (!rawSource) return { filePath: null, lineNumber: null };
  try {
    const source = JSON.parse(rawSource);
    if (source && typeof source === 'object') {
      return {
        filePath: source.fileName || source.filePath || null,
        lineNumber: positiveInteger(source.lineNumber || source.line),
      };
    }
  } catch (_) {
    // Also accept a common "absolute/path.tsx:42[:column]" transform format.
  }
  const match = rawSource.match(/^(.*):(\d+)(?::\d+)?$/);
  return match
    ? { filePath: match[1] || null, lineNumber: positiveInteger(match[2]) }
    : { filePath: rawSource, lineNumber: null };
}

function createCssSelector(element) {
  if (!isElement(element)) return null;
  if (element.id) return `#${escapeCss(element.id)}`;

  const parts = [];
  for (let node = element; isElement(node) && node !== document.documentElement; node = node.parentElement) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`${part}#${escapeCss(node.id)}`);
      break;
    }
    const classes = [...node.classList].slice(0, 2);
    if (classes.length) part += classes.map((name) => `.${escapeCss(name)}`).join('');
    const siblings = node.parentElement
      ? [...node.parentElement.children].filter((child) => child.tagName === node.tagName)
      : [];
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    parts.unshift(part);
  }
  return parts.join(' > ');
}

function escapeCss(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function makeJsonSafe(value, depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (depth >= 4) return '[truncated]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => makeJsonSafe(item, depth + 1, seen));

  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = makeJsonSafe(item, depth + 1, seen);
  return result;
}
