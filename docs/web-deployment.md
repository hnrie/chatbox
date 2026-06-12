# Deploying the Chatbox Web Version

The web build is a fully client-side SPA: all data (settings, sessions, knowledge base) stays in the visitor's browser (IndexedDB + OPFS), and LLM provider requests are sent from the browser — through a small same-origin CORS proxy function when one is deployed. There is no backend or database to operate.

```
pnpm build:web        # output: release/app/dist/renderer
```

## What a host must provide

| Requirement | Why |
|---|---|
| SPA fallback (`/* -> /index.html`) | The web build uses history-based routing (`/settings/provider`, `/session/:id`, ...) |
| `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: credentialless` | Enables `SharedArrayBuffer`, required by the in-browser WASM SQLite database that powers Knowledge Base and attachment RAG. Without these headers the app still works, but those two features are disabled. |
| (Optional) CORS proxy function at `/proxy-api/completions` | Lets the app reach LLM providers / search engines that don't send CORS headers. Without it, the app transparently falls back to Chatbox's hosted proxy (`cors-proxy.chatboxai.app`). |

The repository ships ready-made configs for all of this.

## Vercel

`vercel.json` is picked up automatically:

- build: `pnpm build:web`, output `release/app/dist/renderer`
- install: `pnpm install --ignore-scripts` with `ELECTRON_SKIP_BINARY_DOWNLOAD=1` (Electron binaries and native desktop modules are not needed for the web build)
- SPA rewrites + COOP/COEP headers
- `api/cors-proxy.mjs` is deployed as a function and rewritten from `/proxy-api/completions`

Steps: import the repository in Vercel ("Framework Preset: Other"), make sure the project uses **Node.js 22**, deploy. No environment variables are required.

## Netlify

`netlify.toml` is picked up automatically:

- build: `pnpm build:web`, publish `release/app/dist/renderer`
- `NODE_VERSION=22`, `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, `PNPM_FLAGS=--ignore-scripts`
- SPA redirect + COOP/COEP headers
- `netlify/functions/cors-proxy.mjs` serves `/proxy-api/completions`

Steps: import the repository in Netlify and deploy. No environment variables are required.

## Self-hosting (any Node server / VPS / Docker)

```
pnpm build:web
node scripts/web-server.mjs --port 8080
```

`scripts/web-server.mjs` serves the static build with SPA fallback, the COOP/COEP headers, and the same CORS proxy at `/proxy-api/completions`.

Environment variables:

- `PORT` — listen port (default `8080`)
- `CHATBOX_PROXY_ALLOW_PRIVATE=true` — allow the proxy to reach private/LAN targets (e.g. an Ollama box on your network). Off by default to prevent SSRF.
- `CHATBOX_DISABLE_ISOLATION=true` — disable COOP/COEP headers (disables Knowledge Base / RAG)

Alternatively run `bash release-web.sh` to get `release/chatbox-web.tar.gz` and unpack it behind any web server — just replicate the SPA fallback and headers (and optionally the proxy) in your nginx/Caddy config.

## Static-only hosts (GitHub Pages, S3, ...)

The app works on hosts without functions or custom headers, with graceful degradation:

- no CORS proxy → provider requests with "API proxy" enabled fall back to Chatbox's hosted proxy
- no COOP/COEP headers → Knowledge Base and attachment-file RAG are hidden (no `SharedArrayBuffer`)
- no SPA fallback → deep links / page reloads on sub-routes 404 (the app itself still loads at `/`)

## How the CORS proxy works

`web/cors-proxy.mjs` implements the same protocol as `cors-proxy.chatboxai.app`: the browser sends the request to `/proxy-api/completions` with the real target URL in the `CHATBOX-TARGET-URI` header; the function forwards the request and streams the response back. On startup the app probes `/proxy-api/completions` once — if the function answers (identified by the `x-chatbox-cors-proxy` response header), all proxied traffic stays on your deployment; otherwise it falls back to the hosted proxy.

Notes:

- requests to `localhost`/LAN targets never use the proxy — the browser calls them directly
- the function refuses loopback/private/metadata targets (SSRF guard) unless `CHATBOX_PROXY_ALLOW_PRIVATE=true`
- provider API keys pass through the proxy in request headers, the function does not log or store them

## Feature matrix on web

| Feature | Status on web |
|---|---|
| Chat with any provider (OpenAI, Claude, Gemini, Ollama, custom hosts, ...) | ✅ direct or via CORS proxy |
| Streaming responses | ✅ (functions stream end-to-end) |
| Knowledge Base & large-attachment RAG | ✅ WASM SQLite + OPFS, needs COOP/COEP headers |
| MCP servers — Remote (http/sse) | ✅ (subject to the MCP server's own CORS policy) |
| MCP servers — Local (stdio) | ❌ desktop only |
| Web search (Bing, DuckDuckGo, Tavily, Bocha, Querit) | ✅ via CORS proxy |
| Attach links | ✅ fetched via CORS proxy, extracted in-browser (Readability) |
| Attach text files | ✅ parsed locally |
| Attach PDF/Office documents | requires Chatbox AI license (remote parsing); local parser is desktop only |
| Auto-update, global hotkeys, system proxy, tray | ❌ not applicable in a browser |

Browser support: Chrome/Edge/Firefox fully; Safari works for chat but currently lacks `COEP: credentialless`, so Knowledge Base/RAG are disabled there.
