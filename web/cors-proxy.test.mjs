import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCorsProxyHandler, isForbiddenTargetUrl, PROXY_MARKER_HEADER, TARGET_URI_HEADER } from './cors-proxy.mjs'

/** Minimal upstream echo/stream server used as proxy target. */
function startUpstream() {
  const server = http.createServer((req, res) => {
    if (req.url === '/echo') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            method: req.method,
            url: req.url,
            headers: req.headers,
            body,
          })
        )
      })
      return
    }
    if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: one\n\n')
      setTimeout(() => {
        res.write('data: two\n\n')
        res.end()
      }, 50)
      return
    }
    if (req.url === '/error') {
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'rate limited' }))
      return
    }
    res.writeHead(404)
    res.end()
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

describe('cors-proxy handler', () => {
  let upstream
  let upstreamOrigin
  // Tests target a local server, so private hosts must be allowed here;
  // the SSRF guard itself is covered separately below.
  const handler = createCorsProxyHandler({ allowPrivateHosts: true })
  const guardedHandler = createCorsProxyHandler()

  beforeAll(async () => {
    upstream = await startUpstream()
    upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`
  })

  afterAll(() => {
    upstream.close()
  })

  it('answers probe requests (no target header) with a marked 200', async () => {
    const res = await handler(new Request('http://proxy.local/proxy-api/completions'))
    expect(res.status).toBe(200)
    expect(res.headers.get(PROXY_MARKER_HEADER)).toBe('true')
    expect(await res.json()).toMatchObject({ ok: true })
  })

  it('forwards method, body and headers to the target', async () => {
    const res = await handler(
      new Request('http://proxy.local/proxy-api/completions', {
        method: 'POST',
        headers: {
          [TARGET_URI_HEADER]: `${upstreamOrigin}/echo`,
          'content-type': 'application/json',
          authorization: 'Bearer sk-test',
          'chatbox-platform': 'web',
          cookie: 'secret=1',
        },
        body: JSON.stringify({ model: 'gpt-test', stream: false }),
      })
    )
    expect(res.status).toBe(200)
    expect(res.headers.get(PROXY_MARKER_HEADER)).toBe('true')
    const echo = await res.json()
    expect(echo.method).toBe('POST')
    expect(JSON.parse(echo.body)).toEqual({ model: 'gpt-test', stream: false })
    expect(echo.headers.authorization).toBe('Bearer sk-test')
    expect(echo.headers['content-type']).toBe('application/json')
    // routing/credential headers must not leak upstream
    expect(echo.headers[TARGET_URI_HEADER]).toBeUndefined()
    expect(echo.headers['chatbox-platform']).toBeUndefined()
    expect(echo.headers.cookie).toBeUndefined()
  })

  it('streams the upstream response body', async () => {
    const res = await handler(
      new Request('http://proxy.local/proxy-api/completions', {
        headers: { [TARGET_URI_HEADER]: `${upstreamOrigin}/stream` },
      })
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(await res.text()).toBe('data: one\n\ndata: two\n\n')
  })

  it('passes upstream error statuses through', async () => {
    const res = await handler(
      new Request('http://proxy.local/proxy-api/completions', {
        headers: { [TARGET_URI_HEADER]: `${upstreamOrigin}/error` },
      })
    )
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate limited' })
  })

  it('rejects invalid target URLs with 400', async () => {
    const res = await handler(
      new Request('http://proxy.local/proxy-api/completions', {
        headers: { [TARGET_URI_HEADER]: 'not a url' },
      })
    )
    expect(res.status).toBe(400)
  })

  it('rejects private/loopback targets with 403 when not allowed', async () => {
    for (const target of [
      'http://localhost:11434/api/chat',
      'http://127.0.0.1:8080/x',
      'http://10.0.0.5/x',
      'http://192.168.1.10/x',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]:3000/x',
      'ftp://example.com/file',
    ]) {
      const res = await guardedHandler(
        new Request('http://proxy.local/proxy-api/completions', {
          headers: { [TARGET_URI_HEADER]: target },
        })
      )
      expect(res.status, target).toBe(403)
    }
  })

  it('returns 502 when the target is unreachable', async () => {
    const res = await handler(
      new Request('http://proxy.local/proxy-api/completions', {
        headers: { [TARGET_URI_HEADER]: 'http://127.0.0.1:1/unreachable' },
      })
    )
    expect(res.status).toBe(502)
  })
})

describe('isForbiddenTargetUrl', () => {
  it('allows normal public https hosts', () => {
    expect(isForbiddenTargetUrl(new URL('https://api.openai.com/v1/chat/completions'))).toBe(false)
    expect(isForbiddenTargetUrl(new URL('http://example.com'))).toBe(false)
  })

  it('blocks metadata and CGNAT addresses', () => {
    expect(isForbiddenTargetUrl(new URL('http://metadata.google.internal/'))).toBe(true)
    expect(isForbiddenTargetUrl(new URL('http://100.100.1.1/'))).toBe(true)
  })

  it('can be relaxed for self-hosting', () => {
    expect(isForbiddenTargetUrl(new URL('http://192.168.1.10/'), { allowPrivateHosts: true })).toBe(false)
  })
})
