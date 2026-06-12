#!/usr/bin/env node
/**
 * Self-host / local server for the Chatbox web build.
 *
 * Serves the static output of `pnpm build:web` (release/app/dist/renderer)
 * with everything the app needs to be fully functional in a browser:
 *   - SPA fallback to index.html (the web build uses history-based routing)
 *   - COOP/COEP headers so the WASM SQLite database (knowledge base / RAG)
 *     can use SharedArrayBuffer
 *   - the same-origin CORS proxy at /proxy-api/completions, identical to the
 *     Vercel/Netlify serverless functions
 *
 * Usage:
 *   pnpm build:web
 *   node scripts/web-server.mjs [--port 8080]
 *
 * Env:
 *   PORT                          listen port (default 8080)
 *   CHATBOX_PROXY_ALLOW_PRIVATE   "true" to let the proxy reach private/LAN hosts
 *   CHATBOX_DISABLE_ISOLATION     "true" to skip COOP/COEP headers
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createCorsProxyHandler } from '../web/cors-proxy.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../release/app/dist/renderer')

const portArgIndex = process.argv.indexOf('--port')
const PORT = Number(portArgIndex !== -1 ? process.argv[portArgIndex + 1] : process.env.PORT) || 8080
const CROSS_ORIGIN_ISOLATION = process.env.CHATBOX_DISABLE_ISOLATION !== 'true'

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

const proxyHandler = createCorsProxyHandler({
  allowPrivateHosts: process.env.CHATBOX_PROXY_ALLOW_PRIVATE === 'true',
})

function setCommonHeaders(res) {
  if (CROSS_ORIGIN_ISOLATION) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
  }
}

function toWebRequest(req) {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`)
  const init = {
    method: req.method,
    headers: req.headers,
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req)
    init.duplex = 'half'
  }
  return new Request(url, init)
}

async function writeWebResponse(res, webResponse) {
  res.statusCode = webResponse.status
  webResponse.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  if (webResponse.body) {
    for await (const chunk of webResponse.body) {
      res.write(chunk)
    }
  }
  res.end()
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase()
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream')
  if (ext !== '.html') {
    res.setHeader('Cache-Control', 'public, max-age=3600')
  } else {
    res.setHeader('Cache-Control', 'no-cache')
  }
  fs.createReadStream(filePath).pipe(res)
}

const server = http.createServer(async (req, res) => {
  setCommonHeaders(res)

  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (url.pathname === '/proxy-api/completions') {
    try {
      const webResponse = await proxyHandler(toWebRequest(req))
      await writeWebResponse(res, webResponse)
    } catch (error) {
      console.error('cors-proxy error:', error)
      if (!res.headersSent) {
        res.statusCode = 500
      }
      res.end(JSON.stringify({ error: String(error) }))
    }
    return
  }

  const requestedPath = path.normalize(decodeURIComponent(url.pathname))
  const filePath = path.join(ROOT, requestedPath)
  if (!filePath.startsWith(ROOT)) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveFile(res, filePath)
    return
  }

  // SPA fallback
  const indexPath = path.join(ROOT, 'index.html')
  if (fs.existsSync(indexPath)) {
    serveFile(res, indexPath)
    return
  }

  res.statusCode = 404
  res.end('Not found. Run `pnpm build:web` first.')
})

server.listen(PORT, () => {
  console.log(`Chatbox web build served at http://localhost:${PORT}`)
  console.log(`  static root:        ${ROOT}`)
  console.log(`  CORS proxy:         /proxy-api/completions`)
  console.log(`  cross-origin-isolation: ${CROSS_ORIGIN_ISOLATION ? 'on (COOP/COEP)' : 'off'}`)
})
