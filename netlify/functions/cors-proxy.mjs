// Netlify function: same-origin CORS proxy for LLM provider requests.
// Served at /proxy-api/completions via the in-code path config below.
import { createCorsProxyHandler } from '../../web/cors-proxy.mjs'

const handler = createCorsProxyHandler({
  allowPrivateHosts: process.env.CHATBOX_PROXY_ALLOW_PRIVATE === 'true',
})

export default (request) => handler(request)

export const config = {
  path: '/proxy-api/completions',
}
