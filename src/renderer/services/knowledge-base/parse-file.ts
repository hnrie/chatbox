import { isTextFilePath } from '@shared/file-extensions'
import type { DocumentParserConfig } from '@shared/types/settings'
import platform from '@/platform'
import { parseFileRemotelyFromStorage } from './remote-file-parser'

export async function parseFileFromStorage(
  storageKey: string,
  fileMeta: { filename: string; mimeType: string },
  kbId: number,
  parserConfig: DocumentParserConfig
): Promise<string> {
  if (isTextFilePath(fileMeta.filename) || parserConfig.type === 'local') {
    const stored = await platform.getStoreBlob(storageKey)
    if (!stored) {
      throw new Error('File content not found in storage')
    }
    if (isTextFilePath(fileMeta.filename)) {
      return stored
    }
  }

  return parseFileRemotelyFromStorage(storageKey, fileMeta.filename, fileMeta.mimeType)
}
