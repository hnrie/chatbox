/**
 * Adapts the web-standard (Request/Response) serverless handlers in
 * proxy-core.mjs to Node's http.IncomingMessage / http.ServerResponse,
 * for the local preview server and the Vite dev server middleware.
 */
import { Readable } from 'node:stream'

export function nodeRequestToFetchRequest(req) {
  const url = `http://${req.headers.host || 'localhost'}${req.url}`
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else if (value !== undefined) {
      headers.set(key, value)
    }
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method)
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? 'half' : undefined,
  })
}

export async function writeFetchResponse(res, response) {
  const headers = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  res.writeHead(response.status, headers)
  if (response.body) {
    for await (const chunk of response.body) {
      res.write(chunk)
    }
  }
  res.end()
}

/**
 * Runs a web-standard fetch handler against a Node req/res pair.
 */
export async function handleNodeRequest(handler, req, res) {
  try {
    const response = await handler(nodeRequestToFetchRequest(req))
    await writeFetchResponse(res, response)
  } catch (err) {
    console.error('serverless handler error:', err)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
    }
    res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }))
  }
}
