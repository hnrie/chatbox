# Web deployment

Chatbox can be deployed as a static single-page app for serverless hosts such as Vercel, Netlify, Cloudflare Pages, or any CDN that can serve static files with an SPA fallback.

## Build contract

- Build command: `pnpm run build:web`
- Publish directory: `release/app/dist/renderer`
- Node: `22.x`
- Package manager: `pnpm` through Corepack
- SPA fallback: rewrite every non-file route to `/index.html`

The web build is browser-only. It stores user data in IndexedDB/localforage and does not require a backend, database, Electron main process, or Electron preload script.

## Vercel

The checked-in `vercel.json` is enough for Vercel:

- installs with `corepack enable && pnpm install --frozen-lockfile`
- builds with `pnpm run build:web`
- serves `release/app/dist/renderer`
- rewrites deep links such as `/settings/provider/openai` to `/index.html`
- caches hashed static assets for one year

## Netlify

The checked-in `netlify.toml` is enough for Netlify:

- builds with `pnpm run build:web`
- publishes `release/app/dist/renderer`
- uses a `/* -> /index.html` rewrite for SPA routing
- caches hashed static assets for one year

## Other static hosts

Use the same build command and publish directory, then configure:

1. Serve `release/app/dist/renderer` as the site root.
2. Fallback unknown routes to `/index.html`.
3. Cache `/js/*`, `/styles/*`, `/assets/*`, `/fonts/*`, and `/images/*` aggressively because filenames are content-hashed.

## Runtime notes

- Provider API keys are stored in the browser on web deployments. Users should only deploy to origins they trust.
- Some LLM providers block browser-origin requests with CORS. Enable the provider's proxy option when available, use a CORS-capable provider endpoint, or point a custom provider at your own OpenAI-compatible serverless proxy.
- Desktop-only features that need local filesystem, native dialogs, MCP stdio, auto-update, or sandbox execution remain disabled in the browser build.
