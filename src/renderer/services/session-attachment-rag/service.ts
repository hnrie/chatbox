import { embedMany } from 'ai'
import { isSessionAttachmentRagSupportedFilePath } from '@shared/file-extensions'
import type {
  SessionAttachment,
  SessionAttachmentIndexingStage,
  SessionAttachmentIndexStatus,
  SessionAttachmentQueryPlan,
} from '@shared/types'
import { createEmbeddingProviderFromModelString } from '@/services/knowledge-base/model-providers'
import {
  cleanupOrphanAttachments,
  createSessionAttachment,
  deleteMessageAttachments,
  deleteSessionAttachments,
  ensureSessionAttachmentRagDatabase,
  listSessionAttachmentsByIds,
  parseSQLiteTimestamp,
  readSessionAttachmentParents,
} from './db'
import { startSessionAttachmentRagWorkerLoop } from './indexing'

const SESSION_ATTACHMENT_EMBEDDING_MODEL = 'chatbox-ai:text-embedding-3-small'
let initialized = false

async function init() {
  if (initialized) {
    return
  }
  await ensureSessionAttachmentRagDatabase()
  startSessionAttachmentRagWorkerLoop()
  initialized = true
}

function toTimestamp(value?: string) {
  return value ? parseSQLiteTimestamp(value) : undefined
}

function mapAttachment(attachment: Awaited<ReturnType<typeof listSessionAttachmentsByIds>>[number]): SessionAttachment {
  return {
    ...attachment,
    indexingStage: attachment.indexingStage as SessionAttachmentIndexingStage | undefined,
    status: attachment.status as SessionAttachmentIndexStatus,
    availability: 'allowed',
    indexStatus: attachment.status as SessionAttachmentIndexStatus,
    chunkCount: attachment.chunkCount ?? 0,
    createdAt: toTimestamp(attachment.createdAt),
    processingStartedAt: toTimestamp(attachment.processingStartedAt),
    completedAt: toTimestamp(attachment.completedAt),
  }
}

export const webSessionAttachmentRagService = {
  async create(params: {
    sessionId: string
    messageId: string
    attachmentStorageKey: string
    filename: string
    mimeType: string
    fileSize: number
    tokenEstimate: number
    parserType?: string
  }) {
    await init()
    if (!isSessionAttachmentRagSupportedFilePath(params.filename)) {
      throw new Error('session_attachment_rag_unsupported_file_type')
    }
    const id = await createSessionAttachment(params)
    const attachment = (await listSessionAttachmentsByIds([id]))[0]
    return mapAttachment(attachment)
  },

  async getAttachments(ids: number[]) {
    await init()
    const attachments = (await listSessionAttachmentsByIds(ids ?? [])).filter(
      (attachment) => attachment.status !== 'canceled'
    )
    return attachments.map(mapAttachment)
  },

  async retryAttachment(attachmentId: number) {
    await init()
    const { db } = await ensureSessionAttachmentRagDatabase()
    await db.execute({
      sql: 'UPDATE session_attachment SET status = ?, indexing_stage = ?, total_chunks = 0, embedded_chunks = 0, error = NULL, processing_started_at = NULL, completed_at = NULL WHERE id = ? AND status = ?',
      args: ['pending', 'queued', attachmentId, 'failed'],
    })
  },

  async rebindAttachment(params: { attachmentId: number; sessionId: string; messageId: string }) {
    await init()
    const { db } = await ensureSessionAttachmentRagDatabase()
    await db.execute({
      sql: 'UPDATE session_attachment SET session_id = ?, message_id = ? WHERE id = ?',
      args: [params.sessionId, params.messageId, params.attachmentId],
    })
  },

  async deleteAttachment(attachmentId: number) {
    await init()
    const { db, vectorStore } = await ensureSessionAttachmentRagDatabase()
    await db.execute({ sql: 'DELETE FROM session_attachment WHERE id = ?', args: [attachmentId] })
    await vectorStore.deleteIndex({ indexName: `sa_${attachmentId}` }).catch(() => undefined)
  },

  deleteMessageAttachments,
  deleteSessionAttachments,

  async cleanupOrphans(params: { sessionIds: string[]; messageIds: string[] }) {
    await init()
    return cleanupOrphanAttachments(params.sessionIds ?? [], params.messageIds ?? [])
  },

  async getDebugSnapshot() {
    await init()
    const { db, vectorStore } = await ensureSessionAttachmentRagDatabase()
    const [attachmentCount, parentCount, chunkCount] = await Promise.all([
      db.execute('SELECT COUNT(*) AS count FROM session_attachment'),
      db.execute('SELECT COUNT(*) AS count FROM session_attachment_parent'),
      db.execute('SELECT COUNT(*) AS count FROM session_attachment_chunk'),
    ])
    const vectorIndexNames = await vectorStore.listIndexes().catch(() => [])
    return {
      dbPath: 'opfs:chatbox_session_rag.db',
      dbSizeBytes: 0,
      vectorDbPath: 'opfs:chatbox_session_rag_vectors.db',
      vectorDbSizeBytes: 0,
      attachmentCount: Number(attachmentCount.rows[0]?.count ?? 0),
      parentCount: Number(parentCount.rows[0]?.count ?? 0),
      chunkCount: Number(chunkCount.rows[0]?.count ?? 0),
      vectorIndexNames: vectorIndexNames.filter((name) => name.startsWith('sa_')),
      statusCounts: { pending: 0, indexing: 0, ready: 0, failed: 0 },
      recentAttachments: [],
    }
  },

  async clearAll() {
    await init()
    const { db, vectorStore } = await ensureSessionAttachmentRagDatabase()
    const rs = await db.execute('SELECT id FROM session_attachment')
    const ids = rs.rows.map((row) => Number(row.id))
    await db.execute('DELETE FROM session_attachment')
    for (const id of ids) {
      await vectorStore.deleteIndex({ indexName: `sa_${id}` }).catch(() => undefined)
    }
    return ids.length
  },

  async runMaintenance(params: { sessionIds: string[]; messageIds: string[] }) {
    await init()
    const orphanDeletedIds = await cleanupOrphanAttachments(params.sessionIds ?? [], params.messageIds ?? [])
    return {
      interruptedFailedCount: 0,
      canceledPurgedCount: 0,
      orphanDeletedIds,
    }
  },

  async query(params: { attachmentIds: number[]; query: string; plan: SessionAttachmentQueryPlan }) {
    await init()
    const attachmentIds = [...new Set((params.attachmentIds ?? []).filter((id) => Number.isFinite(id)))]
    if (!params.query?.trim() || attachmentIds.length === 0) {
      return []
    }

    const attachments = await listSessionAttachmentsByIds(attachmentIds)
    const readyAttachments = attachments.filter((attachment) => attachment.status === 'ready')
    if (readyAttachments.length === 0) {
      return []
    }

    const embeddingModel = await createEmbeddingProviderFromModelString(SESSION_ATTACHMENT_EMBEDDING_MODEL)
    const embedding = await embedMany({ model: embeddingModel, values: [params.query], maxRetries: 0 })
    const { vectorStore } = await ensureSessionAttachmentRagDatabase()
    const queryVector = embedding.embeddings[0]
    const recallTopK = Math.max(1, Math.min(params.plan?.recallTopK ?? 20, 20))
    const finalTopK = Math.max(1, Math.min(params.plan?.finalTopK ?? 8, 12))

    const results = await Promise.all(
      readyAttachments.map(async (attachment) => {
        try {
          return await vectorStore.query({
            indexName: `sa_${attachment.id}`,
            queryVector,
            topK: recallTopK,
          })
        } catch {
          return []
        }
      })
    )

    let rankedResults = results.flat().sort((a, b) => b.score - a.score)

    const deduped = new Map<number, (typeof rankedResults)[number]>()
    for (const hit of rankedResults) {
      const parentId = Number(hit.metadata?.parentId)
      if (!deduped.has(parentId)) {
        deduped.set(parentId, hit)
      }
    }

    return [...deduped.values()]
      .slice(0, finalTopK)
      .map((hit) => ({
        attachmentId: Number(hit.metadata?.attachmentId),
        parentId: Number(hit.metadata?.parentId),
        filename: String(hit.metadata?.filename ?? ''),
        sectionPath: hit.metadata?.sectionPath ? String(hit.metadata.sectionPath) : undefined,
        chunkOrder: Number(hit.metadata?.chunkOrder ?? 0),
        text: String(hit.metadata?.rawText ?? hit.metadata?.text ?? ''),
        score: hit.score,
      }))
  },

  async readParents(params: { parentIds: number[]; attachmentIds: number[] }) {
    await init()
    const rows = await readSessionAttachmentParents(params.parentIds ?? [], params.attachmentIds ?? [])
    return rows.map((row) => ({
      id: Number(row.id),
      attachmentId: Number(row.attachment_id),
      parentOrder: Number(row.parent_order),
      sectionPath: row.section_path ? String(row.section_path) : undefined,
      filename: String(row.filename),
      text: String(row.text),
      tokenEstimate: Number(row.token_estimate ?? 0),
      charCount: Number(row.char_count ?? 0),
    }))
  },
}
