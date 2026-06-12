export { createWasmLibsqlClient } from './create-client'
export { getKnowledgeBaseDatabase, getSessionAttachmentRagDatabase, resetWasmDatabasesForTests } from './db-manager'

export function isWasmDatabaseSupported(): boolean {
  // The Turso WASM database persists to OPFS and coordinates with its I/O
  // worker through SharedArrayBuffer. SharedArrayBuffer only exists in
  // cross-origin-isolated contexts (COOP + COEP response headers), which the
  // bundled deployment configs (vercel.json / netlify.toml /
  // scripts/web-server.mjs) set up. Without them the app still works, but
  // knowledge base / attachment RAG are disabled.
  return (
    typeof window !== 'undefined' &&
    typeof window.indexedDB !== 'undefined' &&
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  )
}
