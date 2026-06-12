import { Readability } from '@mozilla/readability'
import { isTextFilePath } from '@shared/file-extensions'
import { v4 as uuidv4 } from 'uuid'
import platform from '@/platform'
import { fetchWithProxy } from '@/utils/request'
import * as remote from '../packages/remote'

export async function parseTextFileLocally(file: File): Promise<{ text: string; isSupported: boolean }> {
  if (!isTextFilePath(file.name)) {
    // 只在桌面端有 attachment.path，网页版本只有 attachment.name
    return { text: '', isSupported: false }
  }
  const text = await file.text()
  return { text, isSupported: true }
}

export async function parseUrlContentFree(url: string) {
  const result = await remote.parseUserLinkFree({ url })
  const key = `parseUrl-` + uuidv4()
  await platform.setStoreBlob(key, result.text)
  return { key, title: result.title }
}

/**
 * Fetches a webpage through the CORS proxy and extracts its readable content
 * in the browser with Readability. Used for attaching links on web.
 */
async function parseUrlContentViaProxy(url: string): Promise<{ key: string; title: string }> {
  const res = await fetchWithProxy(url, {
    method: 'GET',
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
  })
  const html = await res.text()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  // Make relative URLs in the document resolve against the original page.
  const base = doc.createElement('base')
  base.href = url
  doc.head.prepend(base)
  const fallbackTitle = doc.querySelector('title')?.textContent?.trim() || url
  const article = new Readability(doc).parse()
  const text = (article?.textContent || '').trim()
  if (!text) {
    throw new Error(`Failed to extract readable content from ${url}`)
  }
  const key = `parseUrl-` + uuidv4()
  await platform.setStoreBlob(key, text)
  return { key, title: article?.title?.trim() || fallbackTitle }
}

export async function parseUrlOnWeb(url: string): Promise<{ key: string; title: string }> {
  try {
    return await parseUrlContentViaProxy(url)
  } catch (err) {
    console.warn('parseUrlOnWeb: local extraction failed, falling back to remote parser', err)
    return parseUrlContentFree(url)
  }
}
