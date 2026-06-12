export { createWasmLibsqlClient } from './create-client'
export { getKnowledgeBaseDatabase, getSessionAttachmentRagDatabase, resetWasmDatabasesForTests } from './db-manager'

export function isWasmDatabaseSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}
