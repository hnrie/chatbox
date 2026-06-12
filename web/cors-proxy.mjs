/**
 * Shared CORS proxy handler for the Chatbox web build.
 *
 * The browser cannot call most LLM provider APIs directly because providers
 * rarely send CORS headers. The desktop app does these requests from the main
 * process; the web app instead routes them through a same-origin proxy that
 * speaks the same protocol as https://cors-proxy.chatboxai.app:
 *
 *   - the real target URL is passed in the `CHATBOX-TARGET-URI` request header
 *   - everything else (method, body, remaining headers) is forwarded as-is
 *   - the upstream response (status, headers, streamed body) is passed back
 *
 * This module is runtime-agnostic (only Web APIs: Request/Response/fetch) so a
 * single implementation backs the Vercel function (api/cors-proxy.mjs), the
 * Netlify function (netlify/functions/cors-proxy.mjs) and the self-host Node
 * server (scripts/web-server.mjs).
 */

export const TARGET_URI_HEADER = 'chatbox-target-uri'
export const PROXY_MARKER_HEADER = 'x-chatbox-cors-proxy'

/** Hop-by-hop headers + headers that must not be forwarded upstream. */
const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'expect',
  'proxy-authorization',
  'proxy-connection',
  'content-length',
  'accept-encoding',
  'cookie',
  'origin',
  'referer',
  'forwarded',
  'via',
])

const STRIPPED_REQUEST_HEADER_PREFIXES = ['x-forwarded-', 'x-vercel-', 'x-nf-', 'x-bb-', 'cf-', 'x-real-ip', 'chatbox-', 'sec-fetch-', 'sec-ch-']

/** Headers that must not be passed back to the browser. */
const STRIPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  // fetch() transparently decompresses the body, so the original encoding
  // headers would no longer match the bytes we send back.
  'content-encoding',
  'content-length',
  // Upstream CORS/security headers are meaningless for the same-origin reply
  // and may conflict with the deployment's own headers.
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'set-cookie',
])

function isPrivateIpv4(hostname) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) {
    return false
  }
  const octets = match.slice(1).map(Number)
  if (octets.some((value) => value > 255)) {
    return false
  }
  const [a, b] = octets
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  return false
}

function isPrivateIpv6(hostname) {
  const value = hostname.toLowerCase()
  if (value === '::' || value === '::1') return true
  if (value.startsWith('fc') || value.startsWith('fd')) return true // unique local fc00::/7
  if (/^fe[89ab]/.test(value)) return true // link local fe80::/10
  const mappedIpv4 = value.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4[1])
  return false
}

/**
 * Best-effort SSRF guard: rejects loopback / private / metadata hostnames so a
 * publicly deployed proxy can't be used to poke at the hosting platform's
 * internal network. Self-hosters that proxy to LAN services (e.g. Ollama on
 * another machine) can opt out via `allowPrivateHosts`.
 */
export function isForbiddenTargetUrl(url, { allowPrivateHosts = false } = {}) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return true
  }
  if (allowPrivateHosts) {
    return false
  }
  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'metadata.google.internal') {
    return true
  }
  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    return true
  }
  return false
}

function buildUpstreamHeaders(requestHeaders) {
  const headers = new Headers()
  requestHeaders.forEach((value, key) => {
    const name = key.toLowerCase()
    if (STRIPPED_REQUEST_HEADERS.has(name)) {
      return
    }
    if (STRIPPED_REQUEST_HEADER_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      return
    }
    headers.set(key, value)
  })
  return headers
}

function buildClientResponseHeaders(upstreamHeaders) {
  const headers = new Headers()
  upstreamHeaders.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  })
  headers.set(PROXY_MARKER_HEADER, 'true')
  return headers
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      [PROXY_MARKER_HEADER]: 'true',
      'cache-control': 'no-store',
    },
  })
}

/**
 * @param {{ allowPrivateHosts?: boolean }} [options]
 * @returns {(request: Request) => Promise<Response>}
 */
export function createCorsProxyHandler(options = {}) {
  return async function handleCorsProxyRequest(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          allow: 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
          [PROXY_MARKER_HEADER]: 'true',
        },
      })
    }

    const targetUri = request.headers.get(TARGET_URI_HEADER)
    if (!targetUri) {
      // Probe request from the app: lets the renderer detect that a
      // same-origin proxy is deployed (a static host without the function
      // would answer with the SPA fallback HTML instead).
      return jsonResponse(200, { ok: true, service: 'chatbox-cors-proxy' })
    }

    let targetUrl
    try {
      targetUrl = new URL(targetUri)
    } catch {
      return jsonResponse(400, { error: `Invalid ${TARGET_URI_HEADER} header: ${targetUri}` })
    }
    if (isForbiddenTargetUrl(targetUrl, options)) {
      return jsonResponse(403, { error: `Target host not allowed: ${targetUrl.hostname}` })
    }

    const init = {
      method: request.method,
      headers: buildUpstreamHeaders(request.headers),
      redirect: 'follow',
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // Request bodies (chat completion payloads) are small; buffering avoids
      // streamed-upload (duplex) incompatibilities between runtimes.
      init.body = await request.arrayBuffer()
    }
    if (request.signal) {
      init.signal = request.signal
    }

    let upstream
    try {
      upstream = await fetch(targetUrl, init)
    } catch (error) {
      return jsonResponse(502, {
        error: `Failed to reach ${targetUrl.origin}: ${error instanceof Error ? error.message : String(error)}`,
      })
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: buildClientResponseHeaders(upstream.headers),
    })
  }
}
