import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import OpenAI from 'openai';
import { WebSocketServer, WebSocket } from 'ws';

const envFile = path.resolve('.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const PORT = Number(process.env.PORT || 8080);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const PROJECT_ROOT = path.resolve(process.env.PROJECT_ROOT || process.cwd());
const HISTORY_DIRECTORY = path.join(PROJECT_ROOT, '.canvasagent-backups');
const HISTORY_FILE = path.join(HISTORY_DIRECTORY, 'history.json');
const SYSTEM_INSTRUCTIONS = [
  'You are an automated JSX refactoring agent.',
  'Modify the provided code snippet according to the user instruction.',
  'Return the complete supplied snippet, not only the changed lines.',
  'Preserve imports and exports required for the snippet to compile in its original file.',
  'When CSS context is supplied, use cssCode only when the requested change needs a stylesheet update; otherwise set cssCode to an empty string.',
  'Return only the requested structured JSON output; do not use Markdown code fences.',
].join(' ');

const colors = {
  cyan: '\x1b[96m', green: '\x1b[92m', yellow: '\x1b[93m', red: '\x1b[91m', dim: '\x1b[2m', reset: '\x1b[0m',
};

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const httpServer = http.createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ service: 'CanvasAgent bridge', status: 'online' }));
});
const wss = new WebSocketServer({ server: httpServer });
const connections = new Set();
const pendingPreviews = new Map();

migrateLegacyHistory();

wss.on('connection', (socket, request) => {
  connections.add(socket);
  hud('CONNECT', `${request.socket.remoteAddress || 'local'} — ${connections.size} active`, 'green');

  socket.on('message', async (rawMessage) => {
    try {
      const payload = JSON.parse(rawMessage.toString());
      if (payload.type === 'MUTATE_REQUEST') await handlePreviewRequest(socket, payload);
      else if (payload.type === 'APPLY_REQUEST') handleApplyRequest(socket, payload);
      else if (payload.type === 'HISTORY_LIST') handleHistoryList(socket, payload);
      else if (payload.type === 'ROLLBACK_REQUEST') handleRollbackRequest(socket, payload);
      else throw new Error(`Unsupported message type: ${String(payload.type)}`);
    } catch (error) {
      hud('ERROR', error.message, 'red');
      send(socket, { status: 'ERROR', message: error.message });
    }
  });

  socket.on('close', () => {
    connections.delete(socket);
    hud('DISCONNECT', `${connections.size} active`, 'yellow');
  });
  socket.on('error', (error) => hud('SOCKET', error.message, 'red'));
  send(socket, { status: 'CONNECTED', message: 'CanvasAgent local bridge ready.' });
});

httpServer.listen(PORT, '127.0.0.1', () => {
  hud('READY', `ws://localhost:${PORT}  |  project root: ${PROJECT_ROOT}`, 'cyan');
  if (!client) hud('CONFIG', 'OPENAI_API_KEY is not set; mutation requests will return an error.', 'yellow');
});

async function handlePreviewRequest(socket, payload) {
  const { filePath, lineNumber, componentName, prompt, selector, classNames = [], computedStyle = {} } = payload;
  if (typeof filePath !== 'string' || !filePath) {
    return sendFallback(socket, selector);
  }
  const localFilePath = resolveProjectFile(filePath);
  if (!fs.existsSync(localFilePath)) {
    hud('FALLBACK', `No local source file: ${filePath}`, 'yellow');
    return sendFallback(socket, selector);
  }
  if (!isInsideProject(localFilePath)) {
    throw new Error(`Refusing to write outside PROJECT_ROOT: ${filePath}`);
  }
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    throw new Error('lineNumber must be a positive integer.');
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('prompt must be a non-empty string.');
  }
  if (!client) throw new Error('OPENAI_API_KEY is required to request a refactor.');

  const fullCode = fs.readFileSync(localFilePath, 'utf-8');
  const lines = fullCode.split(/\r?\n/);
  const window = surgicalWindow(lines, lineNumber);
  // Every local selection provides its available styling context. The model,
  // rather than a hardcoded prompt keyword list, decides whether CSS changes
  // are needed for the requested outcome.
  const styleTarget = findStyleTarget(classNames);
  hud('MUTATE', `${componentName || 'Unknown component'} @ ${path.basename(localFilePath)}:${lineNumber}`, 'cyan');

  const response = await client.responses.create({
    model: MODEL,
    text: { format: { type: 'json_schema', name: 'viewport_hud_patch', strict: true, schema: {
      type: 'object', additionalProperties: false,
      required: ['jsxCode', 'cssCode', 'summary'],
      properties: {
        jsxCode: { type: 'string' }, cssCode: { type: 'string' }, summary: { type: 'string' },
      },
    } } },
    input: [
      { role: 'developer', content: SYSTEM_INSTRUCTIONS },
      {
        role: 'user',
        content: [
          `File: ${localFilePath}`,
          `Component: ${componentName || 'unknown'}`,
          `Requested change: ${prompt.trim()}`,
          `Replace exactly lines ${window.startLine + 1}-${window.endLine} with the returned JSX snippet.`,
          `Selected element classes: ${classNames.join(' ') || '(none)'}`,
          `Selected computed styles: ${JSON.stringify(computedStyle)}`,
          'Current snippet:',
          '```jsx',
          window.code,
          '```',
          ...(styleTarget ? [
            `If the request needs a stylesheet change, cssCode must replace exactly the CSS rule on lines ${styleTarget.window.startLine + 1}-${styleTarget.window.endLine} in ${styleTarget.filePath}; otherwise return an empty cssCode string.`,
            'CSS context:', '```css', styleTarget.window.code, '```',
          ] : []),
        ].join('\n'),
      },
    ],
  });

  const proposal = JSON.parse(response.output_text);
  const refactoredCode = proposal.jsxCode;
  validateRefactor(window.code, refactoredCode);
  const patches = [{
    filePath: localFilePath, componentName: componentName || null, lineNumber, prompt: prompt.trim(), kind: 'mutation',
    updatedCode: replaceWindow(lines, window, refactoredCode), diff: createDiff(localFilePath, window.code, refactoredCode),
  }];
  if (styleTarget && proposal.cssCode.trim()) {
    const cssCode = proposal.cssCode;
    const cssLines = styleTarget.fullCode.split(/\r?\n/);
    if (!hasBalancedBraces(cssCode)) throw new Error('Generated CSS has unbalanced braces.');
    if (!classNames.some((className) => cssCode.includes(`.${className}`))) {
      throw new Error('Generated CSS does not preserve the selected element selector.');
    }
    patches.push({
      filePath: styleTarget.filePath, componentName: componentName || null, lineNumber: styleTarget.window.startLine + 1,
      prompt: `Style update: ${prompt.trim()}`, kind: 'style-mutation',
      updatedCode: replaceWindow(cssLines, styleTarget.window, cssCode), diff: createDiff(styleTarget.filePath, styleTarget.window.code, cssCode),
    });
  }
  const previewId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  pendingPreviews.set(previewId, { patches, createdAt: Date.now(), summary: proposal.summary });
  send(socket, { type: 'PREVIEW', status: 'PREVIEW', previewId, summary: proposal.summary,
    patches: patches.map(({ filePath, diff }) => ({ filePath, diff })) });
}

function handleApplyRequest(socket, payload) {
  const preview = pendingPreviews.get(payload.previewId);
  if (!preview || Date.now() - preview.createdAt > 5 * 60 * 1000) throw new Error('This preview has expired. Generate it again.');
  const backups = [];
  try {
    for (const patch of preview.patches) {
      if (!isInsideProject(patch.filePath)) throw new Error('Preview contains a path outside PROJECT_ROOT.');
      const backupPath = createBackup(patch.filePath);
      backups.push({ ...patch, backupPath });
    }
    for (const patch of backups) fs.writeFileSync(patch.filePath, patch.updatedCode, 'utf-8');
  } catch (error) {
    for (const patch of backups) fs.copyFileSync(patch.backupPath, patch.filePath);
    throw error;
  }
  const transactionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  for (const patch of backups) recordHistory({ ...patch, transactionId });
  pendingPreviews.delete(payload.previewId);
  hud('WRITTEN', `${backups.length} file${backups.length === 1 ? '' : 's'} updated — HMR should refresh.`, 'green');
  send(socket, { type: 'APPLIED', status: 'SUCCESS', message: 'Changes applied. HMR triggered.' });
}

function handleHistoryList(socket, payload) {
  const filePath = typeof payload.filePath === 'string' ? resolveProjectFile(payload.filePath) : null;
  const componentName = typeof payload.componentName === 'string' ? payload.componentName : null;
  const history = readHistory();
  const matching = history.filter((entry) => (
    entry.kind !== 'rollback'
    && (componentName ? entry.componentName === componentName : entry.filePath === filePath)
  ));
  const seen = new Set();
  const entries = matching
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((entry) => {
      const key = historyCheckpointKey(history, entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 25)
    .map((entry) => ({
      id: entry.id, componentName: entry.componentName, lineNumber: entry.lineNumber,
      prompt: displayPrompt(entry.prompt), createdAt: entry.createdAt, kind: entry.kind,
      fileCount: checkpointEntries(history, entry).length,
    }));
  send(socket, { type: 'HISTORY', status: 'SUCCESS', filePath, entries });
}

function handleRollbackRequest(socket, payload) {
  const history = readHistory();
  const revision = history.find((entry) => entry.id === payload.revisionId);
  if (!revision) throw new Error('The requested revision no longer exists.');
  const revisions = checkpointEntries(history, revision);
  const backups = [];
  try {
    for (const entry of revisions) {
      const restorePath = entry.snapshotPath || entry.backupPath;
      if (!isInsideProject(entry.filePath) || !restorePath || !fs.existsSync(restorePath)) {
        throw new Error('The requested revision backup is unavailable.');
      }
      backups.push({ ...entry, restorePath, backupPath: createBackup(entry.filePath) });
    }
    for (const entry of backups) fs.copyFileSync(entry.restorePath, entry.filePath);
  } catch (error) {
    for (const entry of backups) fs.copyFileSync(entry.backupPath, entry.filePath);
    throw error;
  }
  const transactionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  for (const entry of backups) {
    recordHistory({
      filePath: entry.filePath, componentName: entry.componentName, lineNumber: entry.lineNumber,
      prompt: `Rollback to ${new Date(revision.createdAt).toLocaleString()}`,
      backupPath: entry.backupPath, kind: 'rollback', transactionId,
    });
  }
  hud('ROLLBACK', `${backups.length} file${backups.length === 1 ? '' : 's'} restored.`, 'green');
  send(socket, {
    type: 'ROLLBACK_COMPLETE', status: 'SUCCESS', filePath: revision.filePath,
    message: 'Revision restored. HMR triggered.',
  });
}

function displayPrompt(prompt) {
  return String(prompt || '').replace(/^Style update:\s*/, '');
}

function historyCheckpointKey(history, entry) {
  if (entry.transactionId) return `transaction:${entry.transactionId}`;
  const group = checkpointEntries(history, entry);
  return `legacy:${group.map((candidate) => candidate.id).sort().join(':')}`;
}

function checkpointEntries(history, entry) {
  if (entry.transactionId) return history.filter((candidate) => candidate.transactionId === entry.transactionId);
  if (entry.kind === 'rollback') return [entry];
  const prompt = displayPrompt(entry.prompt);
  const timestamp = Date.parse(entry.createdAt);
  return history.filter((candidate) => (
    candidate.componentName === entry.componentName
    && candidate.kind !== 'rollback'
    && displayPrompt(candidate.prompt) === prompt
    && Math.abs(Date.parse(candidate.createdAt) - timestamp) < 10_000
  ));
}

function surgicalWindow(lines, lineNumber) {
  // The requested 50-line window is centered as closely as possible on the target line.
  const targetIndex = Math.min(lineNumber - 1, Math.max(0, lines.length - 1));
  const startLine = Math.max(0, targetIndex - 25);
  const endLine = Math.min(lines.length, startLine + 50);
  return { startLine, endLine, code: lines.slice(startLine, endLine).join('\n') };
}

function replaceWindow(lines, window, replacement) {
  return [
    ...lines.slice(0, window.startLine),
    ...replacement.split(/\r?\n/),
    ...lines.slice(window.endLine),
  ].join('\n');
}

function createDiff(filePath, before, after) {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  return [`--- ${path.relative(PROJECT_ROOT, filePath)}`, `+++ ${path.relative(PROJECT_ROOT, filePath)}`,
    ...beforeLines.map((line) => `- ${line}`), ...afterLines.map((line) => `+ ${line}`)].join('\n');
}

function hasBalancedBraces(css) {
  let depth = 0;
  for (const character of css) {
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function extractJsxBlock(text) {
  const match = String(text || '').match(/```(?:jsx|tsx|javascript|js)?\s*\n([\s\S]*?)```/i);
  if (!match) throw new Error('Model response did not contain the required fenced JSX block.');
  return match[1].replace(/\n$/, '');
}

function extractCssBlock(text) {
  const match = String(text || '').match(/```css\s*\n([\s\S]*?)```/i);
  if (!match) throw new Error('Model response did not contain the required fenced CSS block.');
  return match[1].replace(/\n$/, '');
}

function findStyleTarget(classNames) {
  if (!Array.isArray(classNames) || !classNames.length) return null;
  const candidates = [];
  for (const filePath of listProjectCssFiles(PROJECT_ROOT)) {
    const fullCode = fs.readFileSync(filePath, 'utf-8');
    for (const className of classNames) {
      let selectorIndex = fullCode.indexOf(`.${className}`);
      while (selectorIndex >= 0) {
        const window = cssRuleWindow(fullCode, selectorIndex);
        if (window) {
          const selector = fullCode.slice(window.selectorStart, window.openingBrace).trim();
          // A dedicated rule such as `.checkout-button { ... }` is safer than
          // a shared rule such as `.checkout-button, .secondary-button { ... }`.
          const score = selector === `.${className}` ? 1000
            : selector.startsWith(`.${className}:`) ? 900
              : selector.includes(',') ? 100 : 400;
          candidates.push({ filePath, fullCode, window, score });
        }
        selectorIndex = fullCode.indexOf(`.${className}`, selectorIndex + className.length + 1);
      }
    }
  }
  return candidates.sort((first, second) => second.score - first.score)[0] || null;
}

function cssRuleWindow(fullCode, selectorIndex) {
  const openingBrace = fullCode.indexOf('{', selectorIndex);
  if (openingBrace < 0) return null;
  let depth = 0;
  let closingBrace = -1;
  for (let index = openingBrace; index < fullCode.length; index += 1) {
    if (fullCode[index] === '{') depth += 1;
    if (fullCode[index] === '}') depth -= 1;
    if (depth === 0) {
      closingBrace = index;
      break;
    }
  }
  if (closingBrace < 0) return null;

  const selectorStart = fullCode.lastIndexOf('\n', selectorIndex) + 1;
  const startLine = fullCode.slice(0, selectorStart).split(/\r?\n/).length - 1;
  const endLine = fullCode.slice(0, closingBrace + 1).split(/\r?\n/).length;
  const lines = fullCode.split(/\r?\n/);
  return { startLine, endLine, selectorStart, openingBrace, code: lines.slice(startLine, endLine).join('\n') };
}

function listProjectCssFiles(directory) {
  const ignored = new Set(['node_modules', '.git', 'dist', '.canvasagent-backups']);
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !ignored.has(entry.name)) files.push(...listProjectCssFiles(path.join(directory, entry.name)));
    else if (entry.isFile() && entry.name.endsWith('.css')) files.push(path.join(directory, entry.name));
  }
  return files;
}

function validateRefactor(originalCode, refactoredCode) {
  if (!refactoredCode.trim()) throw new Error('Model returned an empty code snippet.');
  if (/\bexport\s+default\b/.test(originalCode) && !/\bexport\s+default\b/.test(refactoredCode)) {
    throw new Error('Model response removed the required default export; original file was not changed.');
  }
}

function isInsideProject(filePath) {
  const absoluteFile = path.resolve(filePath);
  return absoluteFile === PROJECT_ROOT || absoluteFile.startsWith(`${PROJECT_ROOT}${path.sep}`);
}

function resolveProjectFile(filePath) {
  return path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(PROJECT_ROOT, filePath);
}

function createBackup(filePath) {
  const relativePath = path.relative(PROJECT_ROOT, filePath);
  const backupPath = path.join(PROJECT_ROOT, '.canvasagent-backups', `${Date.now()}-${relativePath}`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch (_) {
    return [];
  }
}

function recordHistory({ filePath, componentName, lineNumber, prompt, backupPath, kind, transactionId = null }) {
  const history = readHistory();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const snapshotPath = createRevisionSnapshot(filePath, id);
  history.push({
    id, filePath, componentName, lineNumber, prompt, backupPath, snapshotPath, kind, transactionId, createdAt: new Date().toISOString(),
  });
  fs.mkdirSync(HISTORY_DIRECTORY, { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-200), null, 2), 'utf-8');
}

function createRevisionSnapshot(filePath, id) {
  const snapshotPath = path.join(HISTORY_DIRECTORY, 'revisions', `${id}-${path.basename(filePath)}`);
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.copyFileSync(filePath, snapshotPath);
  return snapshotPath;
}

function migrateLegacyHistory() {
  const history = readHistory();
  let changed = false;
  for (let index = 0; index < history.length; index += 1) {
    const entry = history[index];
    if (entry.snapshotPath && fs.existsSync(entry.snapshotPath)) continue;

    // Earlier history entries stored the state *before* an edit. The next
    // entry's backup is the state produced by this entry; the final entry's
    // state is the current file.
    const nextForFile = history.slice(index + 1).find((candidate) => (
      candidate.filePath === entry.filePath && fs.existsSync(candidate.backupPath)
    ));
    const sourcePath = nextForFile?.backupPath || (fs.existsSync(entry.filePath) ? entry.filePath : null);
    if (!sourcePath) continue;
    entry.snapshotPath = createRevisionSnapshot(sourcePath, entry.id);
    changed = true;
  }
  if (changed) {
    fs.mkdirSync(HISTORY_DIRECTORY, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  }
}

function sendFallback(socket, selector) {
  send(socket, {
    status: 'FALLBACK_CSS',
    message: 'Source file is unavailable. Applied a temporary inline CSS preview.',
    selector: selector || null,
    css: 'outline: 2px solid #00f2fe; box-shadow: 0 0 15px rgba(0, 242, 254, 0.8);',
  });
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function hud(label, message, color) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${colors.dim}${timestamp}${colors.reset} ${colors[color]}[HUD:${label}]${colors.reset} ${message}`);
}
