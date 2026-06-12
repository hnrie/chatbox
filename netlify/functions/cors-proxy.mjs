// Netlify Function: streaming CORS proxy for LLM provider requests.
import { corsProxyHandler } from '../../serverless/proxy-core.mjs'

export default (request) => corsProxyHandler(request)

export const config = {
  path: '/proxy-api/*',
}
