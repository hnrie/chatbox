/**
 * Production-like local preview of the web build.
 *
 * Serves release/app/dist/renderer as a SPA (history fallback to index.html)
 * and mounts the same serverless handlers used on Vercel/Netlify:
 *   /proxy-api/*        -> streaming CORS proxy
 *   /api/fetch-webpage  -> server-side webpage reader
 *
 * Usage: pnpm build:web && pnpm preview:web [--port 8080]
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleNodeRequest } from '../serverless/node-adapter.mjs'
import { corsProxyHandler, fetchWebpageHandler } from '../serverless/proxy-core.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.resolve(__dirname, '../release/app/dist/renderer')
const portArgIndex = process.argv.indexOf('--port')
const PORT = portArgIndex !== -1 ? Number(process.argv[portArgIndex + 1]) : Number(process.env.PORT) || 8080

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  let filePath = path.join(DIST_DIR, urlPath)
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA history fallback, mirrors the rewrites configured for Vercel/Netlify
    filePath = path.join(DIST_DIR, 'index.html')
  }
  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/proxy-api/')) {
      await handleNodeRequest(corsProxyHandler, req, res)
      return
    }
    if (req.url.startsWith('/api/fetch-webpage')) {
      await handleNodeRequest(fetchWebpageHandler, req, res)
      return
    }
    serveStatic(req, res)
  } catch (err) {
    console.error('preview-web error:', err)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
    }
    res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }))
  }
})

if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.error(`No web build found at ${DIST_DIR}. Run \`pnpm build:web\` first.`)
  process.exit(1)
}

server.listen(PORT, () => {
  console.log(`Chatbox web preview running at http://localhost:${PORT}`)
  console.log('  SPA fallback:    enabled')
  console.log('  CORS proxy:      /proxy-api/*')
  console.log('  Webpage reader:  /api/fetch-webpage')
})
