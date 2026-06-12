# Chatbox Web Deployment

Chatbox ships as a **static single-page application (SPA)**. There is no Node.js server at runtime — the build output is plain HTML, JS, CSS, and WASM assets that work on serverless static hosts.

## Build

```bash
pnpm install
pnpm build:web
```

Output directory:

```
release/app/dist/renderer/
```

Quick local preview after building:

```bash
pnpm preview:web
```

## Development

Run the renderer in a normal browser (no Electron):

```bash
pnpm dev:web
```

Open `http://localhost:1212` in Chrome, Firefox, or Edge.

## Deploy to Vercel

1. Import the repository in [Vercel](https://vercel.com/).
2. Framework preset: **Other**.
3. Build command: `pnpm build:web`
4. Output directory: `release/app/dist/renderer`

`vercel.json` in the repo root configures SPA rewrites and cache headers automatically.

## Deploy to Netlify

1. Import the repository in [Netlify](https://www.netlify.com/).
2. Build command: `pnpm build:web`
3. Publish directory: `release/app/dist/renderer`

`netlify.toml` and `public/_redirects` configure SPA fallback and headers.

## Deploy to Cloudflare Pages

1. Create a Pages project connected to this repo.
2. Build command: `pnpm build:web`
3. Build output directory: `release/app/dist/renderer`
4. Add a **Single Page Application** fallback rule: `/*` → `/index.html` (200).

## Other static hosts

Any host that can serve static files works if you:

1. Upload the contents of `release/app/dist/renderer/`.
2. Configure **SPA fallback** so unknown paths return `index.html` with HTTP 200.
3. Serve over **HTTPS** (required for OPFS / WASM knowledge base).

## Runtime behavior (browser)

| Feature | Web support |
|---------|-------------|
| Chat with API keys | Yes — external provider calls use the Chatbox CORS proxy automatically |
| Local Ollama (`localhost`) | Yes — direct fetch, no proxy |
| Knowledge Base / session RAG | Yes — requires a modern browser with IndexedDB + OPFS (Chrome, Edge, recent Firefox) |
| Chatbox AI email login | Yes |
| Provider OAuth (OpenAI, etc.) | Desktop only — use API keys on web |
| MCP stdio / Skills / sandbox | Desktop only |
| System proxy / hotkeys / auto-update | Desktop only |

## Environment variables

No secrets are required at **build** time for a basic self-hosted deployment. Users configure provider API keys inside the app UI; data stays in the browser.

Optional build-time variables (same as desktop):

| Variable | Purpose |
|----------|---------|
| `SENTRY_AUTH_TOKEN` | Upload source maps to Sentry |
| `SENTRY_RELEASE` / `SENTRY_DIST` | Override release metadata |

## CI release script

```bash
pnpm release:web
```

This runs `build:web` and verifies `index.html` exists in the output directory.

## Troubleshooting

**404 on refresh or deep links**  
Add SPA fallback (`/* → /index.html` with status 200). See `vercel.json`, `netlify.toml`, or `public/_redirects`.

**LLM requests fail with CORS errors**  
Web builds automatically route non-localhost provider traffic through `https://cors-proxy.chatboxai.app`. Ensure the host serves the app over HTTPS.

**Knowledge Base unavailable**  
Use a browser with OPFS support. Private/incognito modes may restrict persistent storage.

**`routeTree.gen.ts` missing in CI**  
`pnpm build:web` generates the TanStack Router route tree during the Vite build. Run a full build before `pnpm test` or `pnpm check` on fresh checkouts.
