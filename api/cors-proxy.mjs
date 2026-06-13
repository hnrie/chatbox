// Vercel Function: streaming CORS proxy for LLM provider requests.
// Exposed as /proxy-api/* via the rewrite in vercel.json.
import { corsProxyHandler } from '../serverless/proxy-core.mjs'

const handler = (request) => corsProxyHandler(request)

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const OPTIONS = handler
export const HEAD = handler
