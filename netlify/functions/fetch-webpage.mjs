// Netlify Function: server-side webpage fetcher/reader for link attachments.
import { fetchWebpageHandler } from '../../serverless/proxy-core.mjs'

export default (request) => fetchWebpageHandler(request)

export const config = {
  path: '/api/fetch-webpage',
}
