# Viewport HUD — Working Context

## Mission

Build **Viewport HUD (Universal Edition)** for a frontend/productivity hackathon. It is a browser extension and local coding bridge that lets a user select a visible UI element, describe a change, and apply a source-aware local refactor with HMR feedback.

## Product statement

Viewport HUD is a spatial frontend-refactoring tool powered by a constrained local coding agent. It replaces browser-to-editor context switching with:

```text
select → identify → instruct → patch → HMR → rollback
```

## Current stage

The project is a **working MVP**. The core localhost loop is implemented and demoable. The next major capability is style-aware, multi-file editing for responsive/CSS/Tailwind requests.

## Current implementation

- `manifest.json`: Manifest V3 configuration; content script runs on matching pages; toolbar action and keyboard shortcut are registered.
- `background.js`: toggles the HUD from the toolbar or command, with on-demand content-script injection fallback.
- `content.js`: native Canvas selection overlay; uses `elementFromPoint`; sends WebSocket mutation/history/rollback requests; shows a floating prompt and component history controls.
- `reactFiberInspector.js`: discovers private React Fiber keys when present and falls back to development DOM attributes or a CSS selector.
- `vite-plugin-viewport-hud-source.js`: Vite/Babel development transform that stamps native JSX DOM elements with `data-source`, `data-inspector-line`, and `data-component`.
- `server.mjs`: local WebSocket server; calls OpenAI Responses API with structured output; generates a source/CSS diff preview; applies confirmed patches transactionally; maintains `.canvasagent-backups/history.json` and revision snapshots.
- `src/`: Vite React demo app. Dedicated component files make the demo safer to patch.

## Important behavior and constraints

- On macOS, Option+A can produce a special character. The HUD checks `event.code === 'KeyA'`, not just `event.key`.
- Extension source changes require reloading the extension at `chrome://extensions` and refreshing the page.
- Vite configuration changes require restarting `npm run dev`.
- Bridge/server changes require restarting `npm run bridge`.
- The bridge reads configuration from `.env`; do not inspect, log, commit, or expose `OPENAI_API_KEY`.
- `PROJECT_ROOT` must be the absolute local project path. The server refuses writes outside it.
- Production Mode cannot modify arbitrary deployed website source. It currently provides a CSS-preview fallback.
- Current file patching uses a 50-line context window. It now requires preview approval before writing, but is not AST-aware and should be upgraded before production use.

## History semantics

- Every revision stores the **resulting file state**, not the state before the change.
- The label “make the button yellow” must restore yellow.
- Legacy history was migrated to result snapshots when the bridge starts.
- History is scoped by selected component/source file. Rolling back restores the file containing that component; dedicated component files give the most element-like rollback behavior.

## User workflow

```text
1. npm run dev
2. npm run bridge
3. Load/reload extension in Chrome or Arc
4. Open Vite localhost page
5. Toggle HUD (Option+A or toolbar icon)
6. Draw around a source-mapped element
7. Submit a precise request
8. Watch HMR update the page
9. Use History to restore a prior revision if needed
```

## Immediate next work

Implement style-aware refactoring for prompts such as “make this button responsive”:

1. Inspect selected element classes, inline styles, and computed styles.
2. Detect project styling conventions: plain CSS, CSS Modules, Tailwind, or inline styles.
3. Locate the relevant stylesheet(s).
4. Send JSX and style context to the local bridge.
5. Safely patch one or more files, with snapshots, validation, and rollback.

## Do not regress

- Preserve the toolbar toggle fallback; keyboard shortcuts are unreliable across browser/keyboard layouts.
- Preserve source mapping fallback order: React Fiber → DOM source attributes → CSS selector.
- Preserve `PROJECT_ROOT` protection and backup-before-write behavior.
- Keep API credentials server-side only.
