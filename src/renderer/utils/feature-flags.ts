import platform from '@/platform'
import { isWasmDatabaseSupported } from '@/platform/libsql-wasm'

export const featureFlags = {
  // Web supports remote (HTTP/SSE) MCP servers; local stdio servers need the desktop app
  mcp: platform.type === 'desktop' || platform.type === 'web',
  knowledgeBase: platform.type === 'desktop' || (platform.type === 'web' && isWasmDatabaseSupported()),
  skills: false,
  taskMode: false,
}
