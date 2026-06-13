import { CapacitorHttp } from '@capacitor/core'
import type { SearchResult } from '@shared/types'
import { isLocalHost } from '@shared/utils/network_utils'
import { type FetchOptions, ofetch } from 'ofetch'
import platform from '@/platform'
import { isSameOriginCorsProxyAvailable } from '@/utils/cors-proxy'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'

const IOS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
const FALLBACK_MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'

export interface ParseLinkResult {
  url: string
  title: string
  content: string
}

function formatHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}

  const result: Record<string, string> = {}
  new Headers(headers).forEach((value, key) => {
    result[key] = value
  })
  return result
}

function getMobileUserAgent() {
  switch (CHATBOX_BUILD_PLATFORM) {
    case 'ios':
      return IOS_USER_AGENT
    case 'android':
      return ANDROID_USER_AGENT
    default:
      return FALLBACK_MOBILE_USER_AGENT
  }
}

function buildUrlWithQuery(url: string, query: FetchOptions['query']): string {
  if (!query) return url
  const u = new URL(url)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const v of value) u.searchParams.append(key, String(v))
    } else {
      u.searchParams.append(key, String(value))
    }
  }
  return u.toString()
}

abstract class WebSearch {
  abstract search(query: string, signal?: AbortSignal): Promise<SearchResult>

  supportsParseLink = false

  /**
   * Parse/extract readable content from a URL.
   * Override in subclasses that support this capability.
   */
  async parseLink(_url: string, _signal?: AbortSignal): Promise<ParseLinkResult | null> {
    return null
  }

  async fetch(url: string, options: FetchOptions) {
    if (platform.type === 'mobile') {
      const method = options.method ?? 'GET'
      const responseType =
        options.responseType === 'text' ? 'text' : options.responseType === 'json' ? 'json' : undefined
      const userAgent = getMobileUserAgent()
      const headers = {
        ...formatHeaders(options.headers),
        'User-Agent': userAgent,
      }
      const response = await CapacitorHttp.request({
        url,
        method,
        headers,
        params: options.query,
        data: options.body,
        ...(responseType ? { responseType } : {}),
      })
      return response.data
    } else if (platform.type === 'web' && !isLocalHost(url) && (await isSameOriginCorsProxyAvailable())) {
      // Browsers block most cross-origin search requests (e.g. Bing SERP scraping);
      // route them through the same-origin CORS proxy shipped with web deployments.
      const targetUri = buildUrlWithQuery(url, options.query)
      const { query: _query, headers: optionHeaders, ...rest } = options
      return ofetch(`${window.location.origin}/proxy-api/completions`, {
        ...rest,
        headers: {
          ...formatHeaders(optionHeaders),
          'CHATBOX-TARGET-URI': targetUri,
          'CHATBOX-PLATFORM': platform.type,
        },
      })
    } else {
      return ofetch(url, options)
    }
  }
}

export default WebSearch
