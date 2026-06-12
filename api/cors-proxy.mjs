// Vercel function: same-origin CORS proxy for LLM provider requests.
// Exposed as /api/cors-proxy and rewritten from /proxy-api/completions (see vercel.json).
import { createCorsProxyHandler } from '../web/cors-proxy.mjs'

const handler = createCorsProxyHandler({
  allowPrivateHosts: process.env.CHATBOX_PROXY_ALLOW_PRIVATE === 'true',
})

export default {
  fetch: (request) => handler(request),
}
