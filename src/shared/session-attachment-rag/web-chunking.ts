import { recursiveChunk } from '@shared/text-chunking'

export interface ParentBlock {
  parentOrder: number
  sectionPath?: string
  text: string
  tokenEstimate: number
  charCount: number
}

export interface ChildChunk {
  parentOrder: number
  chunkOrder: number
  sectionPath?: string
  rawText: string
  tokenEstimate: number
}

export function buildEmbeddedText(params: {
  filename: string
  sectionPath?: string
  pageRange?: string
  text: string
}): string {
  const prefixParts = [params.filename]
  if (params.sectionPath) {
    prefixParts.push(params.sectionPath)
  }
  if (params.pageRange) {
    prefixParts.push(params.pageRange)
  }
  return `[${prefixParts.join(' > ')}]\n${params.text}`
}

export async function buildAttachmentChunks(content: string, filename?: string) {
  const chunks = await recursiveChunk(content, { maxSize: 448, overlap: 64 })
  const parents: ParentBlock[] = [
    {
      parentOrder: 0,
      sectionPath: filename,
      text: content,
      tokenEstimate: Math.ceil(content.length / 4),
      charCount: content.length,
    },
  ]

  const childChunks: ChildChunk[] = chunks.map((chunk, index) => ({
    parentOrder: 0,
    chunkOrder: index,
    sectionPath: filename,
    rawText: chunk.text,
    tokenEstimate: Math.ceil(chunk.text.length / 4),
  }))

  return { parents, chunks: childChunks }
}
