// Vercel Function: server-side webpage fetcher/reader for link attachments.
// Exposed as /api/fetch-webpage.
import { fetchWebpageHandler } from '../serverless/proxy-core.mjs'

const handler = (request) => fetchWebpageHandler(request)

export const POST = handler
export const OPTIONS = handler
