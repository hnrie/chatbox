import platform from '@/platform'
import { isWasmDatabaseSupported } from '@/platform/libsql-wasm'

export function supportsKnowledgeBase(): boolean {
  return platform.type === 'desktop' || (platform.type === 'web' && isWasmDatabaseSupported())
}

export function supportsSessionAttachmentRag(): boolean {
  return platform.type === 'desktop' || (platform.type === 'web' && isWasmDatabaseSupported())
}
