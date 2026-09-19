# Viewport HUD

## Run the local demo

1. Copy `.env.example` to `.env` and add `OPENAI_API_KEY`.
2. Install packages: `npm install`.
3. In one terminal, run `npm run dev` and open the displayed localhost URL.
4. In another terminal, run `npm run bridge`.
5. At `chrome://extensions`, enable Developer mode and choose **Load unpacked** for this folder.
6. On the demo page, press `Alt + A`, draw over **Complete purchase**, enter a request, and press Enter.

The demo button includes source attributes so the HUD can reliably map it to `src/App.jsx`.

## Safety

- Keep `.env` private.
- The bridge only writes beneath `PROJECT_ROOT` (the repository root by default).
- Before every write, it saves the original file under `.canvasagent-backups/`.
