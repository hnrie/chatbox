/**
 * Shared, platform-agnostic (web standard Request/Response) handlers powering
 * the self-hosted CORS proxy of the Chatbox web version.
 *
 * They are consumed by:
 *   - api/cors-proxy.mjs + api/fetch-webpage.mjs        (Vercel Functions)
 *   - netlify/functions/cors-proxy.mjs + fetch-webpage  (Netlify Functions)
 *   - scripts/preview-web.mjs                           (local production-like preview)
 *
 * Protocol (compatible with https://cors-proxy.chatboxai.app used by the official build):
 *   - POST/GET /proxy-api/completions with the target URL in the `CHATBOX-TARGET-URI`
 *     header; everything else (method, body, remaining headers) is forwarded verbatim
 *     and the upstream response is streamed back.
 *   - GET /proxy-api/health returns a JSON marker that the web app probes at runtime
 *     to decide whether a same-origin proxy is available.
 *   - POST /api/fetch-webpage with {"url": "..."} returns {"title", "text"} with the
 *     readable content of the page (used by the free-tier link attachment parser).
 *
 * Environment variables:
 *   CHATBOX_PROXY_ALLOWED_HOSTS    optional comma-separated allowlist of upstream hosts
 *                                  (supports leading wildcard, e.g. "*.openai.com").
 *                                  When unset, every public host is allowed.
 *   CHATBOX_PROXY_ALLOW_PRIVATE    set to "1"/"true" to allow upstream requests to
 *                                  private/loopback hosts (useful for self-hosting).
 *   CHATBOX_PROXY_ALLOWED_ORIGINS  optional comma-separated list of origins (or "*")
 *                                  that get CORS response headers. Unset means the proxy
 *                                  is same-origin only, which is what the bundled web
 *                                  app needs.
 */

export const TARGET_URI_HEADER = 'chatbox-target-uri'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const STRIPPED_REQUEST_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  'host',
  'content-length',
  'accept-encoding',
  'origin',
  'referer',
  'cookie',
  'chatbox-target-uri',
  'chatbox-platform',
  'chatbox-version',
])

const STRIPPED_REQUEST_HEADER_PREFIXES = ['x-forwarded-', 'x-vercel-', 'x-nf-', 'x-netlify-', 'cf-', 'sec-', 'x-real-']

// fetch() transparently decompresses, so the original encoding headers no longer apply
const STRIPPED_RESPONSE_HEADERS = new Set([...HOP_BY_HOP_HEADERS, 'content-encoding', 'content-length', 'set-cookie'])

function truthy(value) {
  return value === '1' || value === 'true' || value === 'yes'
}

function getAllowedHosts(env) {
  const raw = env.CHATBOX_PROXY_ALLOWED_HOSTS
  if (!raw) return null
  const hosts = raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return hosts.length > 0 ? hosts : null
}

function hostMatches(hostname, pattern) {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1) // ".example.com"
    return hostname.endsWith(suffix) || hostname === pattern.slice(2)
  }
  return hostname === pattern
}

function isPrivateIPv4(hostname) {
  const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const octets = m.slice(1).map(Number)
  if (octets.some((o) => o > 255)) return false
  const [a, b] = octets
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  return false
}

function isPrivateHostname(rawHostname) {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
  if (hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.lan')) return true
  if (isPrivateIPv4(hostname)) return true
  // IPv6 loopback / link-local / unique-local
  if (hostname === '::' || hostname === '::1') return true
  if (/^(fe80|fc|fd)/i.test(hostname) && hostname.includes(':')) return true
  // IPv4-mapped IPv6
  if (hostname.startsWith('::ffff:')) return isPrivateIPv4(hostname.slice(7))
  return false
}

/**
 * Returns an error message when the target is not allowed, or null when it is.
 */
export function validateTarget(targetUri, env = process.env) {
  let url
  try {
    url = new URL(targetUri)
  } catch {
    return `Invalid target URL: ${targetUri}`
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `Unsupported protocol: ${url.protocol}`
  }
  if (!truthy(env.CHATBOX_PROXY_ALLOW_PRIVATE) && isPrivateHostname(url.hostname)) {
    return `Target host is not allowed: ${url.hostname}`
  }
  const allowedHosts = getAllowedHosts(env)
  if (allowedHosts && !allowedHosts.some((pattern) => hostMatches(url.hostname.toLowerCase(), pattern))) {
    return `Target host is not in CHATBOX_PROXY_ALLOWED_HOSTS: ${url.hostname}`
  }
  return null
}

function buildCorsHeaders(request, env = process.env) {
  const raw = env.CHATBOX_PROXY_ALLOWED_ORIGINS
  if (!raw) return {}
  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  if (origins.length === 0) return {}
  const requestOrigin = request.headers.get('origin')
  let allowOrigin
  if (origins.includes('*')) {
    allowOrigin = '*'
  } else if (requestOrigin && origins.includes(requestOrigin)) {
    allowOrigin = requestOrigin
  }
  if (!allowOrigin) return {}
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
    ...(allowOrigin === '*' ? {} : { Vary: 'Origin' }),
  }
}

function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })
}

function buildForwardHeaders(request) {
  const headers = new Headers()
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (STRIPPED_REQUEST_HEADERS.has(lower)) return
    if (STRIPPED_REQUEST_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))) return
    headers.set(key, value)
  })
  return headers
}

/**
 * Generic streaming CORS proxy. Web-standard Request in, web-standard Response out.
 */
export async function corsProxyHandler(request, env = process.env) {
  const corsHeaders = buildCorsHeaders(request, env)
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const targetUri = request.headers.get(TARGET_URI_HEADER)
  if (!targetUri) {
    // Doubles as the health endpoint probed by the web app.
    return jsonResponse({ ok: true, service: 'chatbox-cors-proxy', version: 1 }, 200, corsHeaders)
  }

  const validationError = validateTarget(targetUri, env)
  if (validationError) {
    return jsonResponse({ ok: false, error: validationError }, 403, corsHeaders)
  }

  const hasBody = !['GET', 'HEAD'].includes(request.method)
  let body
  if (hasBody) {
    body = await request.arrayBuffer()
  }

  let upstream
  try {
    upstream = await fetch(targetUri, {
      method: request.method,
      headers: buildForwardHeaders(request),
      body,
      redirect: 'follow',
    })
  } catch (err) {
    return jsonResponse({ ok: false, error: `Upstream request failed: ${err?.message || err}` }, 502, corsHeaders)
  }

  const responseHeaders = new Headers()
  upstream.headers.forEach((value, key) => {
    if (STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) return
    responseHeaders.set(key, value)
  })
  for (const [key, value] of Object.entries(corsHeaders)) {
    responseHeaders.set(key, value)
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}

const PAGE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/**
 * Fetches a web page server-side and extracts readable {title, text}.
 * Response shape matches https://cors-proxy.chatboxai.app/api/fetch-webpage.
 */
export async function fetchWebpageHandler(request, env = process.env) {
  const corsHeaders = buildCorsHeaders(request, env)
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, corsHeaders)
  }

  let url
  try {
    const payload = await request.json()
    url = payload?.url
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400, corsHeaders)
  }
  if (!url || typeof url !== 'string') {
    return jsonResponse({ ok: false, error: 'Missing "url" in request body' }, 400, corsHeaders)
  }

  const validationError = validateTarget(url, env)
  if (validationError) {
    return jsonResponse({ ok: false, error: validationError }, 403, corsHeaders)
  }

  let html
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': PAGE_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    })
    if (!res.ok) {
      return jsonResponse({ ok: false, error: `Failed to fetch page: status ${res.status}` }, 502, corsHeaders)
    }
    html = await res.text()
  } catch (err) {
    return jsonResponse({ ok: false, error: `Failed to fetch page: ${err?.message || err}` }, 502, corsHeaders)
  }

  try {
    const [{ parseHTML }, { Readability }] = await Promise.all([import('linkedom'), import('@mozilla/readability')])
    const { document } = parseHTML(html)
    const article = new Readability(document, { charThreshold: 50 }).parse()
    const title = article?.title || document.querySelector('title')?.textContent?.trim() || url
    const text = article?.textContent?.trim() || document.body?.textContent?.replace(/\s+/g, ' ').trim() || ''
    return jsonResponse({ title, text }, 200, corsHeaders)
  } catch (err) {
    return jsonResponse({ ok: false, error: `Failed to parse page: ${err?.message || err}` }, 500, corsHeaders)
  }
}
