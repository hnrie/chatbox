import type { Client } from '@libsql/client'
import type { WasmVectorStore } from '@/platform/libsql-wasm/vector-store'
import { getSessionAttachmentRagDatabase } from '@/platform/libsql-wasm/db-manager'

const SCHEMA_VERSION = 2
let initialized = false

export async function ensureSessionAttachmentRagDatabase(): Promise<{ db: Client; vectorStore: WasmVectorStore }> {
  const handle = await getSessionAttachmentRagDatabase()
  if (!initialized) {
    await initDB(handle.db)
    initialized = true
  }
  return handle
}

async function initDB(client: Client) {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS session_attachment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      attachment_storage_key TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      token_estimate INTEGER DEFAULT 0,
      parser_type TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      indexing_stage TEXT DEFAULT NULL,
      total_chunks INTEGER DEFAULT 0,
      embedded_chunks INTEGER DEFAULT 0,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processing_started_at DATETIME,
      completed_at DATETIME
    )`,
    `CREATE TABLE IF NOT EXISTS session_attachment_parent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attachment_id INTEGER NOT NULL,
      parent_order INTEGER NOT NULL,
      section_path TEXT,
      doc_type TEXT,
      page_start INTEGER,
      page_end INTEGER,
      text TEXT NOT NULL,
      token_estimate INTEGER DEFAULT 0,
      char_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (attachment_id) REFERENCES session_attachment(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS session_attachment_chunk (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attachment_id INTEGER NOT NULL,
      parent_id INTEGER NOT NULL,
      chunk_order INTEGER NOT NULL,
      section_path TEXT,
      page_start INTEGER,
      page_end INTEGER,
      raw_text TEXT NOT NULL,
      embedded_text TEXT NOT NULL,
      token_estimate INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (attachment_id) REFERENCES session_attachment(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES session_attachment_parent(id) ON DELETE CASCADE
    )`,
  ])

  const versionResult = await client.execute('PRAGMA user_version')
  const currentVersion = Number(versionResult.rows[0]?.user_version ?? 0)
  if (currentVersion < SCHEMA_VERSION) {
    const migrations = [
      'ALTER TABLE session_attachment ADD COLUMN indexing_stage TEXT DEFAULT NULL',
      'ALTER TABLE session_attachment ADD COLUMN total_chunks INTEGER DEFAULT 0',
      'ALTER TABLE session_attachment ADD COLUMN embedded_chunks INTEGER DEFAULT 0',
    ]
    for (const sql of migrations) {
      await client.execute(sql).catch((error) => {
        if (error instanceof Error && error.message.includes('duplicate column name')) {
          return
        }
        throw error
      })
    }
    await client.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }
}

export function parseSQLiteTimestamp(sqliteTimestamp: string): number {
  const utcDate = new Date(`${sqliteTimestamp} UTC`)
  const timestamp = utcDate.getTime()
  return Number.isNaN(timestamp) ? Date.now() : timestamp
}

export async function createSessionAttachment(params: {
  sessionId: string
  messageId: string
  attachmentStorageKey: string
  filename: string
  mimeType: string
  fileSize: number
  tokenEstimate: number
  parserType?: string
}) {
  const { db } = await ensureSessionAttachmentRagDatabase()
  const rs = await db.execute({
    sql: `INSERT INTO session_attachment
      (session_id, message_id, attachment_storage_key, filename, mime_type, file_size, token_estimate, parser_type, status, indexing_stage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      params.sessionId,
      params.messageId,
      params.attachmentStorageKey,
      params.filename,
      params.mimeType,
      params.fileSize,
      params.tokenEstimate,
      params.parserType ?? null,
      'pending',
      'queued',
    ],
  })
  return Number(rs.lastInsertRowid)
}

export async function listSessionAttachmentsByIds(ids: number[]) {
  if (ids.length === 0) {
    return []
  }
  const { db } = await ensureSessionAttachmentRagDatabase()
  const placeholders = ids.map(() => '?').join(',')
  const rs = await db.execute({
    sql: `SELECT a.*,
      (SELECT COUNT(*) FROM session_attachment_chunk c WHERE c.attachment_id = a.id) AS chunk_count
      FROM session_attachment a
      WHERE a.id IN (${placeholders})`,
    args: ids,
  })
  return rs.rows.map(mapAttachmentRow)
}

export async function listPendingSessionAttachments(limit = 10) {
  const { db } = await ensureSessionAttachmentRagDatabase()
  const rs = await db.execute({
    sql: `SELECT a.*,
      (SELECT COUNT(*) FROM session_attachment_chunk c WHERE c.attachment_id = a.id) AS chunk_count
      FROM session_attachment a
      WHERE a.status = ?
      ORDER BY a.created_at ASC
      LIMIT ?`,
    args: ['pending', limit],
  })
  return rs.rows.map(mapAttachmentRow)
}

function mapAttachmentRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    sessionId: String(row.session_id),
    messageId: String(row.message_id),
    attachmentStorageKey: String(row.attachment_storage_key),
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    fileSize: Number(row.file_size ?? 0),
    tokenEstimate: Number(row.token_estimate ?? 0),
    chunkCount: Number(row.chunk_count ?? 0),
    totalChunks: Number(row.total_chunks ?? 0),
    embeddedChunks: Number(row.embedded_chunks ?? 0),
    indexingStage: row.indexing_stage ? String(row.indexing_stage) : undefined,
    parserType: row.parser_type ? String(row.parser_type) : undefined,
    status: String(row.status),
    error: row.error ? String(row.error) : undefined,
    createdAt: row.created_at ? String(row.created_at) : undefined,
    processingStartedAt: row.processing_started_at ? String(row.processing_started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
  }
}

export async function readSessionAttachmentParents(parentIds: number[], allowedAttachmentIds: number[]) {
  if (parentIds.length === 0 || allowedAttachmentIds.length === 0) {
    return []
  }
  const { db } = await ensureSessionAttachmentRagDatabase()
  const parentPlaceholders = parentIds.map(() => '?').join(',')
  const attachmentPlaceholders = allowedAttachmentIds.map(() => '?').join(',')
  const rs = await db.execute({
    sql: `SELECT p.*, a.filename
      FROM session_attachment_parent p
      JOIN session_attachment a ON a.id = p.attachment_id
      WHERE p.id IN (${parentPlaceholders})
        AND p.attachment_id IN (${attachmentPlaceholders})`,
    args: [...parentIds, ...allowedAttachmentIds],
  })
  return rs.rows
}

export async function deleteMessageAttachments(messageId: string) {
  const { db, vectorStore } = await ensureSessionAttachmentRagDatabase()
  const rs = await db.execute({ sql: 'SELECT id FROM session_attachment WHERE message_id = ?', args: [messageId] })
  const ids = rs.rows.map((row) => Number(row.id))
  for (const id of ids) {
    await db.execute({ sql: 'DELETE FROM session_attachment WHERE id = ?', args: [id] })
    await vectorStore.deleteIndex({ indexName: `sa_${id}` }).catch(() => undefined)
  }
  return ids
}

export async function deleteSessionAttachments(sessionId: string) {
  const { db, vectorStore } = await ensureSessionAttachmentRagDatabase()
  const rs = await db.execute({ sql: 'SELECT id FROM session_attachment WHERE session_id = ?', args: [sessionId] })
  const ids = rs.rows.map((row) => Number(row.id))
  for (const id of ids) {
    await db.execute({ sql: 'DELETE FROM session_attachment WHERE id = ?', args: [id] })
    await vectorStore.deleteIndex({ indexName: `sa_${id}` }).catch(() => undefined)
  }
  return ids
}

export async function cleanupOrphanAttachments(validSessionIds: string[], validMessageIds: string[]) {
  const { db, vectorStore } = await ensureSessionAttachmentRagDatabase()
  const validSessionIdSet = new Set(validSessionIds)
  const validMessageIdSet = new Set(validMessageIds)
  const rs = await db.execute({ sql: 'SELECT id, session_id, message_id FROM session_attachment' })
  const orphanIds = rs.rows
    .map((row) => ({
      id: Number(row.id),
      sessionId: String(row.session_id),
      messageId: String(row.message_id),
    }))
    .filter((row) => !validSessionIdSet.has(row.sessionId) || !validMessageIdSet.has(row.messageId))
    .map((row) => row.id)

  for (const id of orphanIds) {
    await db.execute({ sql: 'DELETE FROM session_attachment WHERE id = ?', args: [id] })
    await vectorStore.deleteIndex({ indexName: `sa_${id}` }).catch(() => undefined)
  }
  return orphanIds
}
