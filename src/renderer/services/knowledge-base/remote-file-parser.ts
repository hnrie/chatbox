import { getChatboxAPIOrigin } from '@shared/request/chatboxai_pool'
import { createAfetch, uploadFile } from '@shared/request/request'
import { getOS } from '@/packages/navigator'
import platform from '@/platform'
import { settingsStore } from '@/stores/settingsStore'

async function getAfetch() {
  return createAfetch({
    type: 'web',
    platform: await platform.getPlatform(),
    os: getOS(),
    version: (await platform.getVersion()) || 'web',
  })
}

function getLicenseKey(): string | undefined {
  return settingsStore.getState().getSettings().licenseKey || undefined
}

async function readStorageAsBlob(storageKey: string, filename: string, mimeType: string): Promise<Blob> {
  const stored = await platform.getStoreBlob(storageKey)
  if (!stored) {
    throw new Error('File content not found in storage')
  }

  if (isProbablyText(stored)) {
    return new Blob([stored], { type: mimeType || 'text/plain' })
  }

  const binary = Uint8Array.from(atob(stored), (char) => char.charCodeAt(0))
  return new Blob([binary], { type: mimeType || 'application/octet-stream' })
}

function isProbablyText(value: string): boolean {
  // Control chars (tab, LF, CR) are intentional: they are the allowed whitespace when detecting plain text.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional whitespace allowlist for text detection
  return !value.startsWith('data:') && /^[\x09\x0A\x0D\x20-\x7E\u0080-\uFFFF]*$/.test(value.slice(0, 512))
}

export async function parseFileRemotelyFromStorage(
  storageKey: string,
  filename: string,
  mimeType: string
): Promise<string> {
  const licenseKey = getLicenseKey()
  if (!licenseKey) {
    throw new Error('Chatbox AI login required for document parsing in the browser')
  }

  const afetch = await getAfetch()
  const generateResponse = await afetch(`${getChatboxAPIOrigin()}/api/files/generate-upload-url`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${licenseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filename }),
  })

  const uploadInfo = (await generateResponse.json()) as { data: { url: string; filename: string } }
  const blob = await readStorageAsBlob(storageKey, filename, mimeType)
  const file = new File([blob], filename, { type: mimeType })
  await uploadFile(file, uploadInfo.data.url)

  const parseResponse = await afetch(`${getChatboxAPIOrigin()}/api/files/parse`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${licenseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filename: uploadInfo.data.filename, mimeType }),
  })

  const parsed = (await parseResponse.json()) as { data?: { content?: string } }
  const content = parsed.data?.content
  if (!content) {
    throw new Error('Remote parsing returned empty content')
  }
  return content
}
