/**
 * Standalone Vite configuration for building the web (SPA) version of Chatbox.
 *
 * Usage:
 *   pnpm build:web-only   – production build → dist/web/
 *   pnpm dev:web          – renderer-only dev server on :1212 (no Electron)
 *   pnpm preview:web      – serve the production build locally
 *
 * This config is intentionally separate from electron.vite.config.ts so that
 * web builds never pull in the Electron main / preload targets.  All feature
 * flags for the renderer are identical to the web path in the shared config;
 * CHATBOX_BUILD_PLATFORM is always hard-wired to "web" here.
 */

import path from 'node:path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import {
  dvhToVh,
  injectBaseTag,
  injectReleaseDate,
  injectViewportContent,
  replacePlausibleDomain,
} from './electron.vite.config'

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'

  return {
    // Point Vite at the renderer source tree so that index.html and all
    // relative imports resolve correctly without extra configuration.
    root: path.resolve(__dirname, 'src/renderer'),

    // "/" base is required for HTML5-history SPA routing on serverless hosts.
    base: '/',

    // Files placed here are copied verbatim to the output root and served at /.
    publicDir: path.resolve(__dirname, 'src/renderer/public'),

    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/renderer'),
        '@shared': path.resolve(__dirname, 'src/shared'),
      },
    },

    plugins: [
      TanStackRouterVite({
        target: 'react',
        autoCodeSplitting: true,
        // Absolute paths so the plugin works regardless of the Vite root.
        routesDirectory: path.resolve(__dirname, 'src/renderer/routes'),
        generatedRouteTree: path.resolve(__dirname, 'src/renderer/routeTree.gen.ts'),
      }),
      react(),
      dvhToVh(),
      // Not desktop → use mobile-friendly viewport (viewport-fit=cover).
      injectViewportContent(false),
      // Inject <base href="/"> so SPA sub-routes resolve assets correctly.
      injectBaseTag(),
      injectReleaseDate(),
      // Swap Plausible data-domain to the web property.
      replacePlausibleDomain(),
    ],

    build: {
      outDir: path.resolve(__dirname, 'dist/web'),
      emptyOutDir: true,
      // es2022 is required for top-level await used by the WASM DB client.
      target: 'es2022',
      sourcemap: false,
      minify: isProduction ? 'esbuild' : false,
      rollupOptions: {
        output: {
          entryFileNames: 'js/[name].[hash].js',
          chunkFileNames: 'js/[name].[hash].js',
          assetFileNames: (assetInfo) => {
            if (assetInfo.name?.endsWith('.css')) {
              return 'styles/[name].[hash][extname]'
            }
            if (/\.(woff|woff2|eot|ttf|otf)$/i.test(assetInfo.name || '')) {
              return 'fonts/[name].[hash][extname]'
            }
            if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(assetInfo.name || '')) {
              return 'images/[name].[hash][extname]'
            }
            return 'assets/[name].[hash][extname]'
          },
          manualChunks(id) {
            const normalizedId = id.split(path.sep).join('/')
            const isNodeModulePackage = (pkg: string) => normalizedId.includes(`/node_modules/${pkg}/`)

            if (normalizedId.includes('/node_modules/')) {
              if (isNodeModulePackage('@ai-sdk') || isNodeModulePackage('ai')) {
                return 'vendor-ai'
              }
              if (isNodeModulePackage('@mantine') || isNodeModulePackage('@tabler')) {
                return 'vendor-ui'
              }
              if (
                isNodeModulePackage('mermaid') ||
                isNodeModulePackage('d3') ||
                /\/node_modules\/d3-[^/]+\//.test(normalizedId)
              ) {
                return 'vendor-charts'
              }
            }
          },
        },
      },
    },

    css: {
      modules: {
        generateScopedName: '[name]__[local]___[hash:base64:5]',
      },
      postcss: path.resolve(__dirname, 'postcss.config.cjs'),
    },

    server: {
      port: Number(process.env.DEV_PORT) || 1212,
      // Allow cross-origin requests from Electron-free browser dev sessions.
      cors: true,
      // COOP + COEP enable window.crossOriginIsolated = true, which is required
      // for SharedArrayBuffer used by the WASM Knowledge Base worker.
      // credentialless COEP allows third-party scripts (GA, Sentry) without
      // requiring them to set Cross-Origin-Resource-Policy themselves.
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
    },

    preview: {
      port: Number(process.env.PREVIEW_PORT) || 4173,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
    },

    define: {
      'process.type': '"renderer"',
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      // Always "unknown" for web builds – no mobile target.
      'process.env.CHATBOX_BUILD_TARGET': JSON.stringify('unknown'),
      // Hard-wired to "web" so WebPlatform is always selected at runtime.
      'process.env.CHATBOX_BUILD_PLATFORM': JSON.stringify('web'),
      'process.env.CHATBOX_BUILD_CHANNEL': JSON.stringify(process.env.CHATBOX_BUILD_CHANNEL || 'unknown'),
      'process.env.USE_LOCAL_API': JSON.stringify(process.env.USE_LOCAL_API || ''),
      'process.env.USE_BETA_API': JSON.stringify(process.env.USE_BETA_API || ''),
      'process.env.USE_NEWDB_API': JSON.stringify(process.env.USE_NEWDB_API || ''),
      'process.env.USE_LOCAL_CHATBOX': JSON.stringify(process.env.USE_LOCAL_CHATBOX || ''),
      'process.env.USE_BETA_CHATBOX': JSON.stringify(process.env.USE_BETA_CHATBOX || ''),
    },

    optimizeDeps: {
      // Force dep optimization to avoid stale .vite cache issues.
      force: true,
      // mermaid needs explicit pre-bundling.
      // database-wasm/vite exports a dev-server-friendly version of the WASM loader.
      include: ['mermaid', '@tursodatabase/database-wasm/vite'],
      esbuildOptions: {
        target: 'es2015',
      },
    },
  }
})
