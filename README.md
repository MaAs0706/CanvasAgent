# Viewport HUD

**Viewport HUD** is a spatial AI frontend-refactoring tool. Instead of searching through a codebase to find the component behind a visible UI element, a developer selects it directly in the browser, describes the desired change, and receives a local source update through Hot Module Replacement (HMR).

```text
Select an element in the browser
→ identify its React/source metadata
→ send a focused refactoring request to a local bridge
→ update source code on disk
→ let Vite refresh the UI
```

## Product vision

Viewport HUD has two complementary modes:

| Mode | Where it runs | Outcome |
| --- | --- | --- |
| Localhost Mode | A local React/Vite project | Source-aware JSX edits, disk writes, HMR, and revision rollback |
| Production Mode | A site whose source is not available locally | Element selection, temporary CSS preview, and a future exportable CSS patch |

The goal is to reduce context switching between the browser preview, DevTools, editor, and AI chat. The browser becomes the spatial surface for frontend iteration.

## Architecture

| Layer | Files | Responsibility |
| --- | --- | --- |
| Chrome Extension | `manifest.json`, `background.js`, `content.js` | Injects the overlay, captures a selection, presents the HUD, and communicates with the local bridge |
| Source Inspector | `reactFiberInspector.js` | Finds React Fiber metadata when available and falls back to DOM source attributes or CSS selectors |
| Development Instrumentation | `vite-plugin-viewport-hud-source.js` | Adds `data-source`, line, and component metadata to native JSX DOM elements during Vite development |
| Local Bridge | `server.mjs` | Receives WebSocket requests, reads source context, calls OpenAI, writes safe patches, and maintains history |
| Demo App | `src/` | A Vite React app used to demonstrate source-aware visual editing |

## Current capabilities

- Full-screen selection overlay, activated with `Alt + A` / `Option + A`, or by clicking the extension toolbar icon.
- React Fiber inspection plus reliable development-time JSX source attributes.
- WebSocket bridge at `ws://localhost:8080`.
- OpenAI-powered JSX refactoring within a focused source window.
- Automatic Vite HMR after a successful disk write.
- Backups and persistent revision history.
- Per-component rollback from the HUD **History** button.
- CSS-preview fallback when a selected element has no local source mapping.

## Run the local demo

1. Copy `.env.example` to `.env` and set your local values:

   ```env
   OPENAI_API_KEY=your_key_here
   PROJECT_ROOT=/absolute/path/to/Canvas Agent
   OPENAI_MODEL=gpt-4o
   PORT=8080
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the Vite demo in one terminal:

   ```bash
   npm run dev
   ```

4. Start the local bridge in another terminal:

   ```bash
   npm run bridge
   ```

5. In Chrome/Arc, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose this repository folder.

6. Open the Vite localhost URL, activate Viewport HUD, draw a selection over an element, type a request, and submit it.

If extension files change, reload the extension at `chrome://extensions` and hard-refresh the Vite page.

## History and rollback

Every mutation first generates a reviewable diff. Only the **Apply changes** action writes to disk; that action backs up the current source file, then saves a revision snapshot representing the resulting change. Select an element, click **History**, choose a revision, and confirm restoration. A rollback also backs up the current file, so it can be reversed later.

Backups and history live in `.canvasagent-backups/`, which is intentionally ignored by Git.

## Safety boundaries

- Never commit `.env` or expose the API key to extension/browser code.
- The bridge only writes under `PROJECT_ROOT`.
- The bridge rejects model responses that remove a required default export from the patched context.
- The current patching strategy is a focused line-window replacement wrapped in a preview/apply transaction; it is suitable for the demo but should evolve toward AST-aware edits and compile validation.
- Viewport HUD cannot rewrite the deployed source code of unrelated external websites. Those sites use Production Mode CSS previews/patches instead.

## Next stage

The current MVP proves the core loop: **visual selection → source mapping → AI patch → HMR → rollback**.

The next milestone is style-aware refactoring: detect CSS, CSS Modules, Tailwind, and inline styles so requests such as “make this button responsive” can safely edit the styling layer as well as the JSX component.
