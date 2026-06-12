import { embedMany } from 'ai'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { buildAttachmentChunks, buildEmbeddedText } from '@shared/session-attachment-rag/web-chunking'
import { createEmbeddingProviderFromModelString } from '@/services/knowledge-base/model-providers'
import { ensureSessionAttachmentRagDatabase, listPendingSessionAttachments } from './db'

const log = getLogger('web-session-attachment-rag:indexing')
const SESSION_ATTACHMENT_EMBEDDING_MODEL = 'chatbox-ai:text-embedding-3-small'
let workerStarted = false

async function indexAttachment(attachment: Awaited<ReturnType<typeof listPendingSessionAttachments>>[number]) {
  const { db, vectorStore } = await ensureSessionAttachmentRagDatabase()
  await db.execute({
    sql: 'UPDATE session_attachment SET status = ?, indexing_stage = ?, processing_started_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?',
    args: ['indexing', 'chunking', attachment.id, 'pending'],
  })

  const stored = await platform.getStoreBlob(attachment.attachmentStorageKey)
  if (!stored) {
    throw new Error('Attachment content not found in storage')
  }

  const { parents, chunks } = await buildAttachmentChunks(stored, attachment.filename)
  if (chunks.length === 0) {
    throw new Error('No chunks generated from attachment')
  }

  await db.execute({ sql: 'DELETE FROM session_attachment_chunk WHERE attachment_id = ?', args: [attachment.id] })
  await db.execute({ sql: 'DELETE FROM session_attachment_parent WHERE attachment_id = ?', args: [attachment.id] })

  const parentIdMap = new Map<number, number>()
  for (const parent of parents) {
    const rs = await db.execute({
      sql: `INSERT INTO session_attachment_parent
        (attachment_id, parent_order, section_path, text, token_estimate, char_count)
        VALUES (?, ?, ?, ?, ?, ?)`,
      args: [attachment.id, parent.parentOrder, parent.sectionPath ?? null, parent.text, parent.tokenEstimate, parent.charCount],
    })
    parentIdMap.set(parent.parentOrder, Number(rs.lastInsertRowid))
  }

  for (const chunk of chunks) {
    const parentId = parentIdMap.get(chunk.parentOrder)
    if (!parentId) {
      continue
    }
    const embeddedText = buildEmbeddedText({
      filename: attachment.filename,
      sectionPath: chunk.sectionPath,
      text: chunk.rawText,
    })
    await db.execute({
      sql: `INSERT INTO session_attachment_chunk
        (attachment_id, parent_id, chunk_order, section_path, raw_text, embedded_text, token_estimate)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        attachment.id,
        parentId,
        chunk.chunkOrder,
        chunk.sectionPath ?? null,
        chunk.rawText,
        embeddedText,
        chunk.tokenEstimate,
      ],
    })
  }

  const embeddingModel = await createEmbeddingProviderFromModelString(SESSION_ATTACHMENT_EMBEDDING_MODEL)
  const embeddedTexts: string[] = []
  const metadata: Array<Record<string, unknown>> = []
  for (const chunk of chunks) {
    const parentId = parentIdMap.get(chunk.parentOrder)
    if (!parentId) {
      continue
    }
    const embeddedText = buildEmbeddedText({
      filename: attachment.filename,
      sectionPath: chunk.sectionPath,
      text: chunk.rawText,
    })
    embeddedTexts.push(embeddedText)
    metadata.push({
      attachmentId: attachment.id,
      parentId,
      filename: attachment.filename,
      sectionPath: chunk.sectionPath,
      chunkOrder: chunk.chunkOrder,
      rawText: chunk.rawText,
      text: chunk.rawText,
    })
  }

  const embeddings = await embedMany({ model: embeddingModel, values: embeddedTexts, maxRetries: 0 })
  const indexName = `sa_${attachment.id}`
  await vectorStore.createIndex({ indexName, dimension: embeddings.embeddings[0].length })
  await vectorStore.upsert({ indexName, vectors: embeddings.embeddings, metadata })

  await db.execute({
    sql: 'UPDATE session_attachment SET status = ?, indexing_stage = ?, total_chunks = ?, embedded_chunks = ?, completed_at = CURRENT_TIMESTAMP, processing_started_at = NULL WHERE id = ?',
    args: ['ready', 'ready', chunks.length, chunks.length, attachment.id],
  })
}

export function startSessionAttachmentRagWorkerLoop() {
  if (workerStarted) {
    return
  }
  workerStarted = true

  const tick = async () => {
    try {
      const pending = await listPendingSessionAttachments(5)
      for (const attachment of pending) {
        try {
          await indexAttachment(attachment)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const { db } = await ensureSessionAttachmentRagDatabase()
          await db.execute({
            sql: 'UPDATE session_attachment SET status = ?, error = ?, processing_started_at = NULL WHERE id = ?',
            args: ['failed', message, attachment.id],
          })
          log.error(`Failed to index attachment ${attachment.id}`, error)
        }
      }
    } catch (error) {
      log.error('Session attachment RAG worker loop error', error)
    } finally {
      window.setTimeout(tick, 3000)
    }
  }

  void tick()
}
