import type { Client } from '@libsql/client'

type QueryResult = {
  id: string
  score: number
  metadata: Record<string, unknown>
}

function parseSqlIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`)
  }
  return name
}

export class WasmVectorStore {
  constructor(private readonly client: Client) {}

  async createIndex({ indexName, dimension }: { indexName: string; dimension: number }) {
    const parsedIndexName = parseSqlIdentifier(indexName)
    await this.client.execute({
      sql: `
        CREATE TABLE IF NOT EXISTS ${parsedIndexName} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          vector_id TEXT UNIQUE NOT NULL,
          embedding F32_BLOB(${dimension}),
          metadata TEXT DEFAULT '{}'
        );
      `,
    })
    try {
      // ANN index is a query optimization only; queries fall back to a full
      // scan with vector_distance_cos. The Turso WASM engine supports the
      // vector functions but not (yet) libsql_vector_idx, so tolerate failure.
      await this.client.execute({
        sql: `
          CREATE INDEX IF NOT EXISTS ${parsedIndexName}_vector_idx
          ON ${parsedIndexName} (libsql_vector_idx(embedding))
        `,
      })
    } catch (error) {
      console.warn(`Vector ANN index not supported by this database engine, using exact search for ${indexName}`, error)
    }
  }

  async upsert({
    indexName,
    vectors,
    metadata,
    ids,
  }: {
    indexName: string
    vectors: number[][]
    metadata?: Array<Record<string, unknown>>
    ids?: string[]
  }) {
    const parsedIndexName = parseSqlIdentifier(indexName)
    const vectorIds = ids || vectors.map(() => crypto.randomUUID())
    const tx = await this.client.transaction('write')
    try {
      for (let i = 0; i < vectors.length; i++) {
        await tx.execute({
          sql: `
            INSERT INTO ${parsedIndexName} (vector_id, embedding, metadata)
            VALUES (?, vector32(?), ?)
            ON CONFLICT(vector_id) DO UPDATE SET
              embedding = vector32(?),
              metadata = ?
          `,
          args: [
            vectorIds[i],
            JSON.stringify(vectors[i]),
            JSON.stringify(metadata?.[i] || {}),
            JSON.stringify(vectors[i]),
            JSON.stringify(metadata?.[i] || {}),
          ],
        })
      }
      await tx.commit()
    } catch (error) {
      await tx.rollback().catch(() => undefined)
      throw error
    }
    return vectorIds
  }

  async query({
    indexName,
    queryVector,
    topK = 10,
    minScore = -1,
  }: {
    indexName: string
    queryVector: number[]
    topK?: number
    minScore?: number
  }): Promise<QueryResult[]> {
    const parsedIndexName = parseSqlIdentifier(indexName)
    const vectorStr = `[${queryVector.join(',')}]`
    const result = await this.client.execute({
      sql: `
        WITH vector_scores AS (
          SELECT
            vector_id as id,
            (1-vector_distance_cos(embedding, '${vectorStr}')) as score,
            metadata
          FROM ${parsedIndexName}
        )
        SELECT *
        FROM vector_scores
        WHERE score > ?
        ORDER BY score DESC
        LIMIT ?
      `,
      args: [minScore, topK],
    })
    return result.rows.map((row) => ({
      id: String(row.id),
      score: Number(row.score),
      metadata: JSON.parse(String(row.metadata ?? '{}')),
    }))
  }

  async deleteIndex({ indexName }: { indexName: string }) {
    const parsedIndexName = parseSqlIdentifier(indexName)
    await this.client.execute({ sql: `DROP TABLE IF EXISTS ${parsedIndexName}` })
  }

  async listIndexes(): Promise<string[]> {
    const result = await this.client.execute({
      sql: `
        SELECT name FROM sqlite_master
        WHERE type='table'
        AND sql LIKE '%F32_BLOB%'
      `,
    })
    return result.rows.map((row) => String(row.name))
  }
}
