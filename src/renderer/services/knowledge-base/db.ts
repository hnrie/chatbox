import type { Client } from '@libsql/client'
import type { WasmVectorStore } from '@/platform/libsql-wasm/vector-store'
import { getLogger } from '@/lib/utils'
import { getKnowledgeBaseDatabase } from '@/platform/libsql-wasm/db-manager'

const log = getLogger('web-knowledge-base:db')

let initialized = false

async function initDB(db: Client) {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS knowledge_base (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      rerank_model TEXT,
      vision_model TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS kb_file (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kb_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      chunk_count INTEGER DEFAULT 0,
      total_chunks INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processing_started_at DATETIME,
      FOREIGN KEY (kb_id) REFERENCES knowledge_base(id)
    )`,
  ])

  const migrations = [
    'ALTER TABLE kb_file ADD COLUMN total_chunks INTEGER DEFAULT 0',
    'ALTER TABLE kb_file ADD COLUMN use_remote_parsing INTEGER DEFAULT 0',
    'ALTER TABLE kb_file ADD COLUMN parsed_remotely INTEGER DEFAULT 0',
    'ALTER TABLE knowledge_base ADD COLUMN document_parser TEXT DEFAULT NULL',
    'ALTER TABLE kb_file ADD COLUMN parser_type TEXT DEFAULT "local"',
    'ALTER TABLE knowledge_base ADD COLUMN provider_mode TEXT DEFAULT NULL',
  ]

  for (const sql of migrations) {
    await db.execute(sql).catch((error) => {
      if (error instanceof Error && !error.message.includes('duplicate column name')) {
        throw error
      }
    })
  }

  await db.execute({
    sql: 'UPDATE kb_file SET status = ?, processing_started_at = NULL WHERE status = ?',
    args: ['paused', 'processing'],
  })

  log.info('[DB] Web knowledge base database initialized')
}

export async function ensureKnowledgeBaseDatabase(): Promise<{ db: Client; vectorStore: WasmVectorStore }> {
  const handle = await getKnowledgeBaseDatabase()
  if (!initialized) {
    await initDB(handle.db)
    initialized = true
  }
  return handle
}

export function parseSQLiteTimestamp(sqliteTimestamp: string): number {
  const utcDate = new Date(`${sqliteTimestamp} UTC`)
  const timestamp = utcDate.getTime()
  return Number.isNaN(timestamp) ? Date.now() : timestamp
}

export async function withTransaction<T>(db: Client, operation: () => Promise<T>): Promise<T> {
  await db.execute('BEGIN TRANSACTION')
  try {
    const result = await operation()
    await db.execute('COMMIT')
    return result
  } catch (error) {
    await db.execute('ROLLBACK').catch(() => undefined)
    throw error
  }
}
