export { createWasmLibsqlClient } from './create-client'
export { getKnowledgeBaseDatabase, getSessionAttachmentRagDatabase, resetWasmDatabasesForTests } from './db-manager'

export function isWasmDatabaseSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.indexedDB !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  )
}

export async function checkWasmDatabaseSupport(): Promise<boolean> {
  if (!isWasmDatabaseSupported()) {
    return false
  }
  try {
    await navigator.storage.getDirectory()
    return true
  } catch {
    return false
  }
}
