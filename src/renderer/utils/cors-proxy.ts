import platform from '@/platform'

/**
 * Resolution of the CORS proxy used for browser-restricted requests.
 *
 * Self-hosted web deployments (Vercel / Netlify / `pnpm preview:web`) ship a
 * same-origin proxy at /proxy-api/* and /api/fetch-webpage (see serverless/).
 * When it is present we prefer it; otherwise we fall back to the proxy
 * operated by Chatbox at cors-proxy.chatboxai.app, matching the previous
 * behavior of the official builds.
 */

export const REMOTE_CORS_PROXY_ORIGIN = 'https://cors-proxy.chatboxai.app'

let probePromise: Promise<boolean> | null = null

async function probeSameOriginProxy(): Promise<boolean> {
  try {
    const res = await fetch('/proxy-api/health', {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) {
      return false
    }
    const json = (await res.json().catch(() => null)) as { service?: string } | null
    return json?.service === 'chatbox-cors-proxy'
  } catch {
    return false
  }
}

export function isSameOriginCorsProxyAvailable(): Promise<boolean> {
  if (platform.type !== 'web') {
    return Promise.resolve(false)
  }
  if (typeof window === 'undefined' || !window.location.protocol.startsWith('http')) {
    return Promise.resolve(false)
  }
  if (!probePromise) {
    probePromise = probeSameOriginProxy()
  }
  return probePromise
}

export async function getCorsProxyOrigin(): Promise<string> {
  return (await isSameOriginCorsProxyAvailable()) ? window.location.origin : REMOTE_CORS_PROXY_ORIGIN
}

/** Endpoint that forwards arbitrary requests, target passed via CHATBOX-TARGET-URI header. */
export async function getCorsProxyCompletionsEndpoint(): Promise<string> {
  return `${await getCorsProxyOrigin()}/proxy-api/completions`
}

/** Endpoint that fetches a webpage server-side and returns readable {title, text}. */
export async function getFetchWebpageEndpoint(): Promise<string> {
  return `${await getCorsProxyOrigin()}/api/fetch-webpage`
}
