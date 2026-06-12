import platform from '@/platform'
import { isWasmDatabaseSupported } from '@/platform/libsql-wasm'

export const featureFlags = {
  mcp: platform.type === 'desktop',
  knowledgeBase: platform.type === 'desktop' || (platform.type === 'web' && isWasmDatabaseSupported()),
  skills: false,
  taskMode: false,
}
