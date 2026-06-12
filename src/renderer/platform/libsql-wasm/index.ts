export { createWasmLibsqlClient } from './create-client'
export { getKnowledgeBaseDatabase, getSessionAttachmentRagDatabase, resetWasmDatabasesForTests } from './db-manager'

export function isWasmDatabaseSupported(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.indexedDB === 'undefined') return false
  // The WASM DB worker uses SharedArrayBuffer for efficient communication,
  // which requires cross-origin isolation (COOP + COEP headers).  Without
  // isolation the postMessage transfer throws a DataCloneError at startup.
  // `window.crossOriginIsolated` is `true` only when both headers are set.
  if (typeof window.crossOriginIsolated !== 'undefined' && !window.crossOriginIsolated) {
    return false
  }
  return true
}
