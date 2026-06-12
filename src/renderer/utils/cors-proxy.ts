import platform from '@/platform'

/** Chatbox's hosted CORS proxy, used by the official web deployment. */
export const REMOTE_CORS_PROXY_ENDPOINT = 'https://cors-proxy.chatboxai.app/proxy-api/completions'

/**
 * Same-origin CORS proxy path. Self-hosted web deployments (Vercel / Netlify /
 * `scripts/web-server.mjs`) expose a serverless function here that speaks the
 * same protocol as the hosted proxy (target URL in the CHATBOX-TARGET-URI
 * header). See web/cors-proxy.mjs.
 */
export const SELF_HOSTED_CORS_PROXY_PATH = '/proxy-api/completions'

/** Marker header the self-hosted proxy sets on every response. */
const PROXY_MARKER_HEADER = 'x-chatbox-cors-proxy'

let selfHostedProxyProbe: Promise<boolean> | null = null

async function probeSelfHostedProxy(): Promise<boolean> {
  // A GET without CHATBOX-TARGET-URI is answered by the proxy with a marked
  // 200. A static host without the function answers with the SPA fallback
  // HTML (no marker header), so this reliably detects proxy availability.
  const res = await fetch(SELF_HOSTED_CORS_PROXY_PATH, { method: 'GET', cache: 'no-store' })
  return res.ok && res.headers.get(PROXY_MARKER_HEADER) === 'true'
}

/**
 * Returns the CORS proxy endpoint to use for provider API requests.
 * On web, prefers the deployment's own same-origin proxy (no third-party
 * dependency, no cross-origin restrictions) and falls back to Chatbox's
 * hosted proxy when none is deployed. The probe result is cached.
 */
export async function getCorsProxyEndpoint(): Promise<string> {
  if (platform.type !== 'web') {
    return REMOTE_CORS_PROXY_ENDPOINT
  }
  if (!selfHostedProxyProbe) {
    selfHostedProxyProbe = probeSelfHostedProxy().catch(() => {
      // Do not cache transient network failures.
      selfHostedProxyProbe = null
      return false
    })
  }
  return (await selfHostedProxyProbe) ? SELF_HOSTED_CORS_PROXY_PATH : REMOTE_CORS_PROXY_ENDPOINT
}

export function resetCorsProxyProbeForTests() {
  selfHostedProxyProbe = null
}
