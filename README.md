# Viewport HUD

## Overview

Viewport HUD is a spatial AI frontend-refactoring tool for local React projects. Instead of switching between a browser preview, DevTools, an editor, and an AI chat, developers select an interface element directly in the browser, describe the change they want, review the proposed code patch, and apply it to their local project.

The changed JSX or CSS is written to disk by a local bridge, then Vite Hot Module Replacement (HMR) updates the running page. Every applied patch is saved as a rollback checkpoint.

## Problem Statement

Small frontend changes often require a surprisingly slow workflow: find the right element in the browser, inspect it, search a large codebase for the component and style rule, make the edit, then return to the browser to verify it.

Designers and QA teammates also struggle to communicate visual changes precisely. A ticket such as “this card should feel more glassy on mobile” leaves the developer to locate the component and interpret the request.

## Solution

Viewport HUD makes the browser preview a direct visual input surface.

1. Press `Alt + A` / `Option + A` and draw a box over a UI element.
2. The extension identifies the element’s React/source metadata when available.
3. Enter a natural-language change request.
4. A local Node.js bridge reads a focused source-code window and asks OpenAI for a structured JSX/CSS proposal.
5. Review the diff, then apply it only when it looks correct.
6. Vite updates the local app with HMR, while Viewport HUD stores a revision for rollback.

For sites whose source code is not on the local machine, Viewport HUD uses a safe CSS-preview fallback rather than claiming it can edit a deployed website’s source.

## Features

- Full-screen spatial selection overlay, activated with `Alt + A` / `Option + A` or the extension toolbar button.
- React Fiber inspection with Vite development-time source-attribute fallback.
- Natural-language React JSX and CSS refactoring proposals through OpenAI.
- Review-before-apply workflow with an in-browser patch panel.
- Local disk patching and instant Vite HMR refresh.
- Persistent per-component history and rollback checkpoints.
- CSS preview fallback for elements without accessible local source.
- A dashboard-style demo surface with navigation, hero content, metric cards, buttons, status, progress, and responsive task cards.

## Tech Stack

- **Frontend:** React 19, Vite, HTML Canvas API, CSS
- **Browser Extension:** Chrome Extension Manifest V3
- **Backend:** Node.js ES Modules, native `fs`, `path`, and `http`
- **Database:** None; revision history is stored locally in `.canvasagent-backups/`
- **APIs / Services:** OpenAI Responses API, WebSockets (`ws`)
- **Hosting / Deployment:** Local Vite development server; Chrome/Arc unpacked extension
- **Other Tools:** Babel/Vite transform plugin for JSX source metadata, Git

## Codex / OpenAI Usage

OpenAI tools were used as a collaborative development assistant during the hackathon for ideation, architecture planning, Chrome Extension Manifest V3 setup, React Fiber/source-inspection design, local WebSocket bridge implementation, debugging, testing, UI iteration, and documentation.

At runtime, the local bridge uses the OpenAI API to convert a selected component’s focused JSX/CSS context and the user’s request into a structured refactoring proposal. The proposal is displayed for review before any source file is written.

The API key remains in the developer’s local `.env` file; it is never exposed to the browser extension.

## Demo



### Demo / Pitch Video

_Add your demo or pitch video link here._

A recommended demo sequence:

1. Select a metric card or primary button with `Option + A`.
2. Request a visual or responsive change.
3. Show the generated review panel.
4. Apply the patch and show the Vite HMR update.
5. Open **History** and restore a previous checkpoint.

## Screenshots

_Add screenshots or GIFs of the overlay, review panel, HMR update, and history rollback here._

## How to Run Locally

```bash
git clone https://github.com/MaAs0706/CanvasAgent.git
cd CanvasAgent
npm install
```

Create a `.env` file from `.env.example` and set the required values:

```env
OPENAI_API_KEY=your_openai_api_key
PROJECT_ROOT=/absolute/path/to/CanvasAgent
OPENAI_MODEL=gpt-4o
PORT=8080
```

Start the Vite demo in one terminal:

```bash
npm run dev
```

Start the local mutation bridge in a second terminal:

```bash
npm run bridge
```

Then load the browser extension:

1. Open `chrome://extensions` in Chrome or Arc.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this project folder.
4. Open the Vite localhost URL.
5. Press `Alt + A` / `Option + A`, select an element, and submit a request.

If you edit extension files, reload the extension from `chrome://extensions` and hard-refresh the Vite page.

## Additional Notes

- Viewport HUD is designed for local development projects. It cannot write source code for unrelated production websites; those use CSS preview fallback mode.
- React Fiber is an internal React implementation detail, so the demo also uses Vite/Babel-injected source attributes for more reliable local mapping.
- Patches are generated from a focused line window and validated before writing. The next technical improvement is AST-aware editing plus automated compile validation.
- Backups and revision snapshots are stored in `.canvasagent-backups/`, which is ignored by Git.
- Run `npm run check` to validate the standalone extension and bridge JavaScript files.
