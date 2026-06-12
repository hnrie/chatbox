import platform from '@/platform'
import { isWasmDatabaseSupported } from '@/platform/libsql-wasm'

export const featureFlags = {
  // Web supports remote (http/sse) MCP servers; stdio servers stay desktop-only.
  mcp: platform.type === 'desktop' || platform.type === 'web',
  knowledgeBase: platform.type === 'desktop' || (platform.type === 'web' && isWasmDatabaseSupported()),
  skills: false,
  taskMode: false,
}
