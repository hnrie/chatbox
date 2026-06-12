export function isWasmDatabaseSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}
