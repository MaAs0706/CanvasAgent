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
const SYSTEM_INSTRUCTIONS = [
  'You are an automated JSX refactoring agent.',
  'Modify the provided code snippet according to the user instruction.',
  'Return the complete supplied snippet, not only the changed lines.',
  'Preserve imports and exports required for the snippet to compile in its original file.',
  'Return ONLY the refactored code snippet inside a ```jsx block.',
  'Do not include markdown conversational text outside the code block.',
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

wss.on('connection', (socket, request) => {
  connections.add(socket);
  hud('CONNECT', `${request.socket.remoteAddress || 'local'} — ${connections.size} active`, 'green');

  socket.on('message', async (rawMessage) => {
    try {
      const payload = JSON.parse(rawMessage.toString());
      if (payload.type !== 'MUTATE_REQUEST') {
        throw new Error(`Unsupported message type: ${String(payload.type)}`);
      }
      await handleMutateRequest(socket, payload);
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

async function handleMutateRequest(socket, payload) {
  const { filePath, lineNumber, componentName, prompt, selector } = payload;
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
  hud('MUTATE', `${componentName || 'Unknown component'} @ ${path.basename(localFilePath)}:${lineNumber}`, 'cyan');

  const response = await client.responses.create({
    model: MODEL,
    input: [
      { role: 'developer', content: SYSTEM_INSTRUCTIONS },
      {
        role: 'user',
        content: [
          `File: ${localFilePath}`,
          `Component: ${componentName || 'unknown'}`,
          `Requested change: ${prompt.trim()}`,
          `Replace exactly lines ${window.startLine + 1}-${window.endLine} with the returned JSX snippet.`,
          'Current snippet:',
          '```jsx',
          window.code,
          '```',
        ].join('\n'),
      },
    ],
  });

  const refactoredCode = extractJsxBlock(response.output_text);
  validateRefactor(window.code, refactoredCode);
  const updatedLines = [
    ...lines.slice(0, window.startLine),
    ...refactoredCode.split(/\r?\n/),
    ...lines.slice(window.endLine),
  ];
  const backupPath = createBackup(localFilePath);
  fs.writeFileSync(localFilePath, updatedLines.join('\n'), 'utf-8');

  hud('WRITTEN', `${path.basename(localFilePath)} — HMR should refresh the page.`, 'green');
  send(socket, {
    status: 'SUCCESS', filePath: localFilePath, lineNumber, backupPath,
    message: 'File written to disk. HMR triggered.',
  });
}

function surgicalWindow(lines, lineNumber) {
  // The requested 50-line window is centered as closely as possible on the target line.
  const targetIndex = Math.min(lineNumber - 1, Math.max(0, lines.length - 1));
  const startLine = Math.max(0, targetIndex - 25);
  const endLine = Math.min(lines.length, startLine + 50);
  return { startLine, endLine, code: lines.slice(startLine, endLine).join('\n') };
}

function extractJsxBlock(text) {
  const match = String(text || '').match(/```(?:jsx|tsx|javascript|js)?\s*\n([\s\S]*?)```/i);
  if (!match) throw new Error('Model response did not contain the required fenced JSX block.');
  return match[1].replace(/\n$/, '');
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
