import path from 'node:path'
import { defineConfig, mergeConfig, type Plugin, type UserConfig } from 'vite'
import packageJson from './release/app/package.json'
import { handleNodeRequest } from './serverless/node-adapter.mjs'
import { corsProxyHandler, fetchWebpageHandler } from './serverless/proxy-core.mjs'
import { createRendererConfig } from './vite.renderer.shared'

/**
 * Mounts the same serverless endpoints used in production (Vercel/Netlify
 * functions) on the Vite dev server, so `pnpm dev:web` behaves like a real
 * deployment: /proxy-api/* (CORS proxy) and /api/fetch-webpage.
 */
function serverlessEndpoints(): Plugin {
  return {
    name: 'chatbox-serverless-endpoints',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/proxy-api/')) {
          void handleNodeRequest(corsProxyHandler, req, res)
          return
        }
        if (req.url?.startsWith('/api/fetch-webpage')) {
          void handleNodeRequest(fetchWebpageHandler, req, res)
          return
        }
        next()
      })
    },
  }
}

/**
 * Standalone web build of the renderer, without Electron.
 *
 * Used by:
 *   pnpm dev:web    -> vite dev server, open http://localhost:1212 in a browser
 *   pnpm build:web  -> static SPA build in release/app/dist/renderer,
 *                      deployable to Vercel / Netlify / Cloudflare Pages / any static host
 */
export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'

  // The renderer code branches on process.env.NODE_ENV at compile time;
  // make sure it is set before createRendererConfig captures it.
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = isProduction ? 'production' : 'development'
  }
  if (!process.env.CHATBOX_BUILD_PLATFORM) {
    process.env.CHATBOX_BUILD_PLATFORM = 'web'
  }

  const inferredRelease = process.env.SENTRY_RELEASE || packageJson.version
  process.env.SENTRY_RELEASE = inferredRelease

  const rendererConfig = createRendererConfig({
    isProduction,
    isWeb: true,
    isMobile: false,
    sentryRelease: inferredRelease,
    sentryDist: process.env.SENTRY_DIST || undefined,
  })

  const webOnly: UserConfig = {
    root: path.resolve(__dirname, 'src/renderer'),
    base: '/',
    plugins: [serverlessEndpoints()],
    build: {
      outDir: path.resolve(__dirname, 'release/app/dist/renderer'),
      emptyOutDir: true,
    },
  }

  return mergeConfig(rendererConfig, webOnly)
})
