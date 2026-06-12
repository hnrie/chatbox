import path from 'node:path'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import type { Plugin, UserConfig } from 'vite'

/**
 * Vite plugin to inject <base href="/"> for web builds
 * This ensures relative paths resolve correctly for SPA routes like /session/xxx
 */
export function injectBaseTag(): Plugin {
  return {
    name: 'inject-base-tag',
    transformIndexHtml() {
      return [
        {
          tag: 'base',
          attrs: { href: '/' },
          injectTo: 'head-prepend', // Inject at the beginning of <head>
        },
      ]
    },
  }
}

/**
 * Vite plugin to inject window.chatbox_release_date for web builds
 */
export function injectReleaseDate(): Plugin {
  const releaseDate = new Date().toISOString().slice(0, 10)
  return {
    name: 'inject-release-date',
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          children: `window.chatbox_release_date="${releaseDate}";`,
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

/**
 * Vite plugin to replace Plausible data-domain for web builds
 */
export function replacePlausibleDomain(): Plugin {
  return {
    name: 'replace-plausible-domain',
    transformIndexHtml(html) {
      return html.replace('data-domain="app.chatboxai.app"', 'data-domain="web.chatboxai.app"')
    },
  }
}

/**
 * Vite plugin to inject platform-appropriate viewport meta content.
 * Desktop builds omit `height=device-height` and `viewport-fit=cover` which trigger
 * Chromium's Virtual Keyboard API on macOS, causing an empty bottom margin on input focus.
 * See: https://github.com/chatboxai/chatbox/issues/2023
 */
export function injectViewportContent(isDesktop: boolean): Plugin {
  const content = isDesktop
    ? 'width=device-width, initial-scale=1, user-scalable=no'
    : 'height=device-height, width=device-width, initial-scale=1, user-scalable=no, viewport-fit=cover'
  return {
    name: 'inject-viewport-content',
    transformIndexHtml(html) {
      return html.replace('%VIEWPORT_CONTENT%', content)
    },
  }
}

/**
 * Vite plugin to replace dvh units with vh units
 * This replaces the webpack string-replace-loader functionality
 */
export function dvhToVh(): Plugin {
  return {
    name: 'dvh-to-vh',
    transform(code, id) {
      if (id.endsWith('.css') || id.endsWith('.scss') || id.endsWith('.sass')) {
        return {
          code: code.replace(/(\d+)dvh/g, '$1vh'),
          map: null,
        }
      }
      return null
    },
  }
}

export interface RendererConfigOptions {
  isProduction: boolean
  isWeb: boolean
  isMobile: boolean
  sentryRelease: string
  sentryDist?: string
}

/**
 * Renderer Vite config shared between the Electron build (electron.vite.config.ts)
 * and the standalone web build (vite.web.config.ts).
 */
export function createRendererConfig(options: RendererConfigOptions): UserConfig {
  const { isProduction, isWeb, isMobile, sentryRelease, sentryDist } = options
  const isDesktop = !isWeb && !isMobile
  const rootDir = __dirname
  const outDir = path.resolve(rootDir, 'release/app/dist/renderer')

  return {
    resolve: {
      alias: {
        '@': path.resolve(rootDir, 'src/renderer'),
        '@shared': path.resolve(rootDir, 'src/shared'),
      },
    },
    plugins: [
      TanStackRouterVite({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: path.resolve(rootDir, 'src/renderer/routes'),
        generatedRouteTree: path.resolve(rootDir, 'src/renderer/routeTree.gen.ts'),
      }),
      react({}),
      dvhToVh(),
      injectViewportContent(isDesktop),
      isWeb ? injectBaseTag() : undefined,
      injectReleaseDate(),
      isWeb ? replacePlausibleDomain() : undefined,
      visualizer({
        filename: 'release/app/dist/renderer/stats.html',
        open: false,
        title: 'Renderer Process Dependency Analysis',
      }),
      process.env.SENTRY_AUTH_TOKEN
        ? sentryVitePlugin({
            authToken: process.env.SENTRY_AUTH_TOKEN,
            org: 'sentry',
            project: 'chatbox',
            url: 'https://sentry.midway.run/',
            release: {
              name: sentryRelease,
              ...(sentryDist ? { dist: sentryDist } : {}),
            },
            sourcemaps: {
              assets: isProduction ? 'release/app/dist/renderer/**' : 'output/renderer/**',
            },
            telemetry: false,
          })
        : undefined,
    ].filter(Boolean),
    build: {
      outDir: isProduction ? outDir : undefined,
      // The WASM database chunk uses top-level await (es2022+). Electron 35
      // (Chromium 134) and modern mobile WebViews support es2022 natively.
      target: 'es2022',
      sourcemap: isProduction ? 'hidden' : true,
      minify: isProduction ? 'esbuild' : false, // Use esbuild for faster, less memory-intensive minification
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
          // Optimize chunk splitting to reduce memory usage during build
          manualChunks(id) {
            const normalizedId = id.split(path.sep).join('/')
            const isNodeModulePackage = (pkg: string) => normalizedId.includes(`/node_modules/${pkg}/`)

            if (normalizedId.includes('/node_modules/')) {
              // Split large vendor chunks
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
      postcss: './postcss.config.cjs',
    },
    server: {
      port: Number(process.env.DEV_PORT) || 1212,
    },
    define: {
      'process.type': '"renderer"',
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      'process.env.CHATBOX_BUILD_TARGET': JSON.stringify(process.env.CHATBOX_BUILD_TARGET || 'unknown'),
      'process.env.CHATBOX_BUILD_PLATFORM': JSON.stringify(process.env.CHATBOX_BUILD_PLATFORM || 'unknown'),
      'process.env.CHATBOX_BUILD_CHANNEL': JSON.stringify(process.env.CHATBOX_BUILD_CHANNEL || 'unknown'),
      'process.env.USE_LOCAL_API': JSON.stringify(process.env.USE_LOCAL_API || ''),
      'process.env.USE_BETA_API': JSON.stringify(process.env.USE_BETA_API || ''),
      'process.env.USE_NEWDB_API': JSON.stringify(process.env.USE_NEWDB_API || ''),
      'process.env.USE_LOCAL_CHATBOX': JSON.stringify(process.env.USE_LOCAL_CHATBOX || ''),
      'process.env.USE_BETA_CHATBOX': JSON.stringify(process.env.USE_BETA_CHATBOX || ''),
    },
    optimizeDeps: {
      // Force a fresh dep optimization on dev startup. This avoids stale .vite
      // cache artifacts that intermittently break MUI internals after branch or
      // dependency changes with runtime errors like "createTheme_default is not a function".
      force: true,
      include: ['mermaid', ...(isWeb ? ['@tursodatabase/database-wasm/vite'] : [])],
      esbuildOptions: {
        target: 'es2015',
      },
    },
  }
}
