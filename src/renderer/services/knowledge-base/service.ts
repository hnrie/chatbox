import type { FileMeta, KnowledgeBase, KnowledgeBaseFile, KnowledgeBaseProviderMode } from '@shared/types'
import type { DocumentParserConfig } from '@shared/types/settings'
import { KNOWLEDGE_BASE_MAX_FILE_SIZE } from '@shared/knowledge-base'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { ensureKnowledgeBaseDatabase, parseSQLiteTimestamp, withTransaction } from './db'
import {
  readFileChunks,
  searchKnowledgeBase,
  startKnowledgeBaseWorkerLoop,
  storeKnowledgeBaseFile,
} from './file-processing'

const log = getLogger('web-knowledge-base:service')
let initialized = false

async function init() {
  if (initialized) {
    return
  }
  await ensureKnowledgeBaseDatabase()
  startKnowledgeBaseWorkerLoop()
  initialized = true
  log.info('Web knowledge base service initialized')
}

export const webKnowledgeBaseService = {
  async list() {
    await init()
    const { db } = await ensureKnowledgeBaseDatabase()
    const rs = await db.execute('SELECT * FROM knowledge_base')
    return rs.rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      embeddingModel: String(row.embedding_model),
      rerankModel: String(row.rerank_model),
      visionModel: row.vision_model ? String(row.vision_model) : undefined,
      providerMode: row.provider_mode ? (String(row.provider_mode) as KnowledgeBase['providerMode']) : undefined,
      documentParser: row.document_parser ? JSON.parse(String(row.document_parser)) : undefined,
      createdAt: parseSQLiteTimestamp(String(row.created_at)),
    }))
  },

  async create(createParams: {
    name: string
    embeddingModel: string
    rerankModel: string
    visionModel?: string
    documentParser?: DocumentParserConfig
    providerMode?: KnowledgeBaseProviderMode
  }) {
    await init()
    const { db } = await ensureKnowledgeBaseDatabase()
    await db.execute({
      sql: 'INSERT INTO knowledge_base (name, embedding_model, rerank_model, vision_model, document_parser, provider_mode) VALUES (?, ?, ?, ?, ?, ?)',
      args: [
        createParams.name,
        createParams.embeddingModel,
        createParams.rerankModel,
        createParams.visionModel ?? null,
        createParams.documentParser ? JSON.stringify(createParams.documentParser) : null,
        createParams.providerMode ?? null,
      ],
    })
  },

  async delete(id: number) {
    await init()
    const { db, vectorStore } = await ensureKnowledgeBaseDatabase()
    await withTransaction(db, async () => {
      await db.execute({ sql: 'DELETE FROM kb_file WHERE kb_id = ?', args: [id] })
      await db.execute({ sql: 'DELETE FROM knowledge_base WHERE id = ?', args: [id] })
    })
    try {
      await vectorStore.deleteIndex({ indexName: `kb_${id}` })
    } catch (error) {
      log.warn(`Failed to delete vector index for knowledge base ${id}`, error)
    }
  },

  async listFiles(kbId: number) {
    await init()
    const { db } = await ensureKnowledgeBaseDatabase()
    const rs = await db.execute({
      sql: 'SELECT * FROM kb_file WHERE kb_id = ? ORDER BY created_at DESC',
      args: [kbId],
    })
    return rs.rows.map(mapFileRow)
  },

  async countFiles(kbId: number) {
    await init()
    const { db } = await ensureKnowledgeBaseDatabase()
    const rs = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM kb_file WHERE kb_id = ?',
      args: [kbId],
    })
    return Number(rs.rows[0]?.count ?? 0)
  },

  async listFilesPaginated(kbId: number, offset = 0, limit = 20) {
    await init()
    const { db } = await ensureKnowledgeBaseDatabase()
    const rs = await db.execute({
      sql: 'SELECT * FROM kb_file WHERE kb_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      args: [kbId, limit, offset],
    })
    return rs.rows.map(mapFileRow)
  },

  async uploadFile(kbId: number, file: FileMeta, rawFile?: File) {
    await init()
    if (!file.name || !file.type || file.size < 0 || file.size > KNOWLEDGE_BASE_MAX_FILE_SIZE) {
      throw new Error('Invalid file metadata')
    }

    let storageKey = file.path
    if (!storageKey) {
      if (!rawFile) {
        throw new Error('File path or raw file is required for web upload')
      }
      storageKey = await storeKnowledgeBaseFile(rawFile)
    }

    const { db } = await ensureKnowledgeBaseDatabase()
    await db.execute({
      sql: 'INSERT INTO kb_file (kb_id, filename, filepath, mime_type, file_size) VALUES (?, ?, ?, ?, ?)',
      args: [kbId, file.name, storageKey, file.type, file.size],
    })
  },

  async deleteFile(fileId: number) {
    await init()
    const { db, vectorStore } = await ensureKnowledgeBaseDatabase()
    await withTransaction(db, async () => {
      const rs = await db.execute({ sql: 'SELECT * FROM kb_file WHERE id = ?', args: [fileId] })
      const file = rs.rows[0]
      if (!file) {
        throw new Error('File not found')
      }
      const indexName = `kb_${file.kb_id}`
      try {
        // biome-ignore lint/suspicious/noExplicitAny: vector table access
        await (vectorStore as any).turso.execute({
          sql: `DELETE FROM ${indexName} WHERE json_extract(metadata, '$.fileId') = ?`,
          args: [fileId],
        })
      } catch (error) {
        log.warn(`Failed to delete vectors for file ${fileId}`, error)
      }
      await db.execute({ sql: 'DELETE FROM kb_file WHERE id = ?', args: [fileId] })
      await platform.delStoreBlob(String(file.filepath)).catch(() => undefined)
    })
  },

  async retryFile(fileId: number, useRemoteParsing = false) {
    await init()
    const { db } = await ensureKnowledgeBaseDatabase()
    await db.execute({
      sql: 'UPDATE kb_file SET status = ?, error = NULL, chunk_count = 0, total_chunks = 0, processing_started_at = NULL, use_remote_parsing = ? WHERE id = ? AND status = ?',
      args: ['pending', useRemoteParsing ? 1 : 0, fileId, 'failed'],
    })
  },

  async pauseFile(fileId: number) {
    await init()
    const { db } = await ensureKnowledgeBaseDatabase()
    await db.execute({
      sql: 'UPDATE kb_file SET status = ?, processing_started_at = NULL WHERE id = ? AND status = ?',
      args: ['paused', fileId, 'processing'],
    })
  },

  async resumeFile(fileId: number) {
    await init()
    const { db } = await ensureKnowledgeBaseDatabase()
    await db.execute({
      sql: 'UPDATE kb_file SET status = ?, error = NULL WHERE id = ? AND status = ?',
      args: ['pending', fileId, 'paused'],
    })
  },

  search: searchKnowledgeBase,

  async update(updateParams: { id: number; name?: string; rerankModel?: string; visionModel?: string }) {
    await init()
    const { db } = await ensureKnowledgeBaseDatabase()
    const assignments: string[] = []
    const args: Array<string | number | null> = []
    if (updateParams.name !== undefined) {
      assignments.push('name = ?')
      args.push(updateParams.name)
    }
    if (updateParams.rerankModel !== undefined) {
      assignments.push('rerank_model = ?')
      args.push(updateParams.rerankModel)
    }
    if (updateParams.visionModel !== undefined) {
      assignments.push('vision_model = ?')
      args.push(updateParams.visionModel)
    }
    if (assignments.length === 0) {
      return
    }
    args.push(updateParams.id)
    await db.execute({
      sql: `UPDATE knowledge_base SET ${assignments.join(', ')} WHERE id = ?`,
      args,
    })
  },

  async getFilesMeta(kbId: number, fileIds: number[]) {
    await init()
    if (fileIds.length === 0) {
      return []
    }
    const { db } = await ensureKnowledgeBaseDatabase()
    const placeholders = fileIds.map(() => '?').join(',')
    const rs = await db.execute({
      sql: `SELECT * FROM kb_file WHERE kb_id = ? AND id IN (${placeholders})`,
      args: [kbId, ...fileIds],
    })
    return rs.rows.map((row) => ({
      id: Number(row.id),
      kbId: Number(row.kb_id),
      filename: String(row.filename),
      mimeType: String(row.mime_type),
      fileSize: Number(row.file_size ?? 0),
      chunkCount: Number(row.chunk_count ?? 0),
      totalChunks: Number(row.total_chunks ?? 0),
      status: String(row.status),
      createdAt: parseSQLiteTimestamp(String(row.created_at)),
    }))
  },

  readFileChunks,

  async testMineruConnection(_apiToken: string) {
    return {
      success: false,
      error: 'MinerU is not available in the browser version',
    }
  },
}

function mapFileRow(row: Record<string, unknown>): KnowledgeBaseFile {
  return {
    id: Number(row.id),
    kb_id: Number(row.kb_id),
    filename: String(row.filename),
    filepath: String(row.filepath),
    mime_type: String(row.mime_type),
    file_size: Number(row.file_size ?? 0),
    chunk_count: Number(row.chunk_count ?? 0),
    total_chunks: Number(row.total_chunks ?? 0),
    status: String(row.status),
    error: row.error ? String(row.error) : '',
    parser_type: String(row.parser_type ?? 'local') as KnowledgeBaseFile['parser_type'],
    parsed_remotely: Number(row.parsed_remotely ?? 0),
    createdAt: parseSQLiteTimestamp(String(row.created_at)),
  }
}
