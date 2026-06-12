import { embedMany } from 'ai'
import { recursiveChunk } from '@shared/text-chunking'
import { isTextFilePath } from '@shared/file-extensions'
import {
  KNOWLEDGE_BASE_MAX_PARSED_CONTENT_SIZE,
  KNOWLEDGE_BASE_PARSED_CONTENT_TOO_LARGE_ERROR,
} from '@shared/knowledge-base'
import { rerank } from '@shared/models/rerank'
import type { DocumentParserConfig } from '@shared/types/settings'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { ensureKnowledgeBaseDatabase } from './db'
import { getEmbeddingProvider, getRerankProvider } from './model-providers'
import { parseFileFromStorage } from './parse-file'

const log = getLogger('web-knowledge-base:file-processing')
let workerStarted = false

async function processFileWithMastra(
  storageKey: string,
  fileMeta: { fileId: number; filename: string; mimeType: string },
  kbId: number,
  parserConfig: DocumentParserConfig
) {
  const { db, vectorStore } = await ensureKnowledgeBaseDatabase()
  const content = await parseFileFromStorage(storageKey, fileMeta, kbId, parserConfig)
  if (new TextEncoder().encode(content).byteLength > KNOWLEDGE_BASE_MAX_PARSED_CONTENT_SIZE) {
    throw new Error(KNOWLEDGE_BASE_PARSED_CONTENT_TOO_LARGE_ERROR)
  }

  const allChunks = await recursiveChunk(content, { maxSize: 1200, overlap: 150 })
  if (!allChunks || allChunks.length === 0) {
    if (parserConfig.type === 'chatbox-ai') {
      await db.execute({
        sql: 'UPDATE kb_file SET chunk_count = 0, status = ? WHERE id = ?',
        args: ['done', fileMeta.fileId],
      })
      return
    }
    throw new Error('No content extracted from file')
  }

  await db.execute({
    sql: 'UPDATE kb_file SET total_chunks = ?, parser_type = ? WHERE id = ?',
    args: [allChunks.length, parserConfig.type, fileMeta.fileId],
  })

  const embeddingInstance = await getEmbeddingProvider(kbId)
  const indexName = `kb_${kbId}`
  const BATCH_SIZE = 50
  const firstEmbedding = await embedMany({
    model: embeddingInstance,
    values: [`filename: ${fileMeta.filename}\nchunk:\n${allChunks[0].text}`],
    maxRetries: 0,
  })
  await vectorStore.createIndex({ indexName, dimension: firstEmbedding.embeddings[0].length })

  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const statusCheck = await db.execute({ sql: 'SELECT status FROM kb_file WHERE id = ?', args: [fileMeta.fileId] })
    if (statusCheck.rows[0]?.status === 'paused') {
      return
    }

    const batchChunks = allChunks.slice(i, i + BATCH_SIZE)
    const batchTexts = batchChunks.map((chunk) => `filename: ${fileMeta.filename}\nchunk:\n${chunk.text}`)
    const embeddingResult = await embedMany({ model: embeddingInstance, values: batchTexts, maxRetries: 0 })
    await vectorStore.upsert({
      indexName,
      vectors: embeddingResult.embeddings,
      metadata: batchChunks.map((chunk, chunkIndex) => ({
        text: chunk.text,
        fileId: fileMeta.fileId,
        filename: fileMeta.filename,
        mimeType: fileMeta.mimeType,
        chunkIndex: i + chunkIndex,
      })),
    })
    await db.execute({
      sql: 'UPDATE kb_file SET chunk_count = ? WHERE id = ?',
      args: [i + batchChunks.length, fileMeta.fileId],
    })
  }

  await db.execute({
    sql: 'UPDATE kb_file SET status = ?, processing_started_at = NULL WHERE id = ?',
    args: ['done', fileMeta.fileId],
  })
}

async function processPendingFiles() {
  const { db } = await ensureKnowledgeBaseDatabase()
  const rs = await db.execute({
    sql: `SELECT f.*, kb.document_parser as kb_document_parser
      FROM kb_file f
      JOIN knowledge_base kb ON f.kb_id = kb.id
      WHERE f.status = ?`,
    args: ['pending'],
  })

  for (const file of rs.rows) {
    const useRemoteParsing = Boolean(file.use_remote_parsing)
    let kbParserConfig: DocumentParserConfig | undefined
    if (file.kb_document_parser) {
      try {
        kbParserConfig = JSON.parse(String(file.kb_document_parser))
      } catch {
        kbParserConfig = undefined
      }
    }
    const parserConfig: DocumentParserConfig = useRemoteParsing
      ? { type: 'chatbox-ai' }
      : kbParserConfig || { type: isTextFilePath(String(file.filename)) ? 'local' : 'chatbox-ai' }

    try {
      await db.execute({
        sql: 'UPDATE kb_file SET status = ?, processing_started_at = CURRENT_TIMESTAMP, use_remote_parsing = 0, parsed_remotely = ?, parser_type = ? WHERE id = ?',
        args: ['processing', useRemoteParsing ? 1 : 0, parserConfig.type, file.id],
      })
      await processFileWithMastra(
        String(file.filepath),
        {
          fileId: Number(file.id),
          filename: String(file.filename),
          mimeType: String(file.mime_type),
        },
        Number(file.kb_id),
        parserConfig
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await db.execute({
        sql: 'UPDATE kb_file SET status = ?, error = ?, processing_started_at = NULL WHERE id = ?',
        args: ['failed', message, file.id],
      })
      log.error(`[FILE] Failed to process file ${file.filename}`, error)
    }
  }
}

export function startKnowledgeBaseWorkerLoop() {
  if (workerStarted) {
    return
  }
  workerStarted = true
  log.info('[FILE] Starting web knowledge base worker loop')

  const tick = async () => {
    try {
      await processPendingFiles()
    } catch (error) {
      log.error('[FILE] Worker loop error', error)
    } finally {
      window.setTimeout(tick, 3000)
    }
  }

  void tick()
}

export async function searchKnowledgeBase(kbId: number, query: string) {
  const { vectorStore } = await ensureKnowledgeBaseDatabase()
  const embeddingInstance = await getEmbeddingProvider(kbId)
  const embedding = await embedMany({ model: embeddingInstance, values: [query], maxRetries: 0 })
  const indexName = `kb_${kbId}`
  const results = await vectorStore.query({
    indexName,
    queryVector: embedding.embeddings[0],
    topK: 20,
  })

  const rerankInstance = await getRerankProvider(kbId)
  if (rerankInstance) {
    const reranked = await rerank(
      results.map((result) => ({ ...result, metadata: result.metadata ?? {} })),
      query,
      rerankInstance,
      { topK: 5 }
    )
    return reranked.map((r) => ({
      id: Number(r.result.id),
      score: r.result.score,
      text: String(r.result.metadata?.text ?? ''),
      fileId: Number(r.result.metadata?.fileId ?? 0),
      filename: String(r.result.metadata?.filename ?? ''),
      mimeType: String(r.result.metadata?.mimeType ?? ''),
      chunkIndex: Number(r.result.metadata?.chunkIndex ?? 0),
    }))
  }

  return results.map((r) => ({
    id: Number(r.id),
    score: r.score,
    text: String(r.metadata?.text ?? ''),
    fileId: Number(r.metadata?.fileId ?? 0),
    filename: String(r.metadata?.filename ?? ''),
    mimeType: String(r.metadata?.mimeType ?? ''),
    chunkIndex: Number(r.metadata?.chunkIndex ?? 0),
  }))
}

export async function readFileChunks(kbId: number, chunks: { fileId: number; chunkIndex: number }[]) {
  if (chunks.length === 0) {
    return []
  }
  const { vectorStore } = await ensureKnowledgeBaseDatabase()
  const indexName = `kb_${kbId}`
  const valuePlaceholders = chunks.map(() => '(?,?)').join(',')
  const condition = `(json_extract(metadata, '$.fileId'), json_extract(metadata, '$.chunkIndex')) IN (${valuePlaceholders})`
  const args = chunks.flatMap((chunk) => [chunk.fileId, chunk.chunkIndex])
  // biome-ignore lint/suspicious/noExplicitAny: vector table access
  const queryResult = await (vectorStore as any).turso.execute({
    sql: `SELECT metadata FROM ${indexName} WHERE ${condition}`,
    args,
  })
  const foundChunks = queryResult.rows.map((row: { metadata: string }) => {
    const metadata = JSON.parse(row.metadata)
    return {
      fileId: metadata.fileId,
      filename: metadata.filename,
      chunkIndex: metadata.chunkIndex,
      text: metadata.text,
    }
  })
  return chunks
    .map((chunk) =>
      foundChunks.find(
        (found: { fileId: number; chunkIndex: number }) =>
          Number(found.fileId) === Number(chunk.fileId) && Number(found.chunkIndex) === Number(chunk.chunkIndex)
      )
    )
    .filter(Boolean)
}

export async function storeKnowledgeBaseFile(file: File): Promise<string> {
  const key = `kb-file-${crypto.randomUUID()}`
  if (isTextFilePath(file.name)) {
    const text = await file.text()
    await platform.setStoreBlob(key, text)
    return key
  }
  const buffer = await file.arrayBuffer()
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
  await platform.setStoreBlob(key, base64)
  return key
}
