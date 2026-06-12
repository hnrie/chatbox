import type { Client, InArgs, InStatement, ResultSet, Row, TransactionMode } from '@libsql/core/api'
import { ResultSetImpl } from '@libsql/core/util'
import type { Database } from '@tursodatabase/database-wasm/bundle'

type NormalizedStatement = {
  sql: string
  args: unknown[]
}

function normalizeStatement(stmtOrSql: InStatement | string, args?: InArgs): NormalizedStatement {
  if (typeof stmtOrSql === 'string') {
    if (args === undefined) {
      return { sql: stmtOrSql, args: [] }
    }
    if (Array.isArray(args)) {
      return { sql: stmtOrSql, args }
    }
    return { sql: stmtOrSql, args: Object.values(args) }
  }

  if (!stmtOrSql.args) {
    return { sql: stmtOrSql.sql, args: [] }
  }
  if (Array.isArray(stmtOrSql.args)) {
    return { sql: stmtOrSql.sql, args: stmtOrSql.args }
  }
  return { sql: stmtOrSql.sql, args: Object.values(stmtOrSql.args) }
}

function toRow(rowObject: Record<string, unknown>, columns: string[]): Row {
  // libsql Row supports access both by index and by column name; consumers
  // (knowledge base / RAG services) read columns by name.
  const row = columns.map((column) => rowObject[column]) as unknown as Row
  for (const column of columns) {
    if (!(column in row)) {
      Object.defineProperty(row, column, { value: rowObject[column], enumerable: false })
    }
  }
  return row
}

function toResultSet(
  rows: Record<string, unknown>[],
  runInfo?: { changes: number; lastInsertRowid: number }
): ResultSet {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : []
  const resultRows = rows.map((rowObject) => toRow(rowObject, columns))
  return new ResultSetImpl(
    columns,
    columns.map(() => ''),
    resultRows,
    runInfo?.changes ?? 0,
    runInfo?.lastInsertRowid !== undefined ? BigInt(runInfo.lastInsertRowid) : undefined
  )
}

function resolveOpfsPath(connectionUrl: string): string {
  if (connectionUrl === ':memory:') {
    return ':memory:'
  }
  if (connectionUrl.startsWith('file:')) {
    const path = connectionUrl.slice('file:'.length)
    return path.replace(/^\/+/, '')
  }
  return connectionUrl.replace(/^\/+/, '')
}

class WasmLibsqlTransaction {
  constructor(
    private readonly db: Database,
    private readonly transactionMode: TransactionMode
  ) {}

  async execute(stmtOrSql: InStatement | string, args?: InArgs): Promise<ResultSet> {
    const { sql, args: bindArgs } = normalizeStatement(stmtOrSql, args)
    const rows = await this.db.all(sql, ...bindArgs)
    return toResultSet(rows)
  }

  async batch(stmts: Array<InStatement | [string, InArgs?]>, _mode?: TransactionMode): Promise<Array<ResultSet>> {
    const results: ResultSet[] = []
    for (const stmt of stmts) {
      if (typeof stmt === 'string') {
        results.push(await this.execute(stmt))
      } else if (Array.isArray(stmt)) {
        results.push(await this.execute(stmt[0], stmt[1]))
      } else {
        results.push(await this.execute(stmt))
      }
    }
    return results
  }

  async rollback(): Promise<void> {
    await this.db.exec('ROLLBACK')
  }

  async commit(): Promise<void> {
    await this.db.exec('COMMIT')
  }

  close(): void {
    // Turso WASM transactions are scoped to exec calls; nothing to close explicitly.
  }

  get mode(): TransactionMode {
    return this.transactionMode
  }
}

class WasmLibsqlClient {
  protocol = 'file' as const
  constructor(private readonly db: Database) {}

  async execute(stmtOrSql: InStatement | string, args?: InArgs): Promise<ResultSet> {
    const { sql, args: bindArgs } = normalizeStatement(stmtOrSql, args)
    const trimmed = sql.trim().toLowerCase()
    const isWrite =
      trimmed.startsWith('insert') ||
      trimmed.startsWith('update') ||
      trimmed.startsWith('delete') ||
      trimmed.startsWith('create') ||
      trimmed.startsWith('alter') ||
      trimmed.startsWith('drop') ||
      trimmed.startsWith('pragma')

    if (isWrite) {
      const runInfo = await this.db.run(sql, ...bindArgs)
      return toResultSet([], runInfo)
    }

    const rows = await this.db.all(sql, ...bindArgs)
    return toResultSet(rows)
  }

  async batch(
    stmts: Array<InStatement | [string, InArgs?]>,
    mode: TransactionMode = 'deferred'
  ): Promise<Array<ResultSet>> {
    const begin =
      mode === 'write' ? 'BEGIN IMMEDIATE' : mode === 'read' ? 'BEGIN TRANSACTION READONLY' : 'BEGIN DEFERRED'
    await this.db.exec(begin)
    try {
      const results: ResultSet[] = []
      for (const stmt of stmts) {
        if (typeof stmt === 'string') {
          results.push(await this.execute(stmt))
        } else if (Array.isArray(stmt)) {
          results.push(await this.execute(stmt[0], stmt[1]))
        } else {
          results.push(await this.execute(stmt))
        }
      }
      await this.db.exec('COMMIT')
      return results
    } catch (error) {
      await this.db.exec('ROLLBACK').catch(() => undefined)
      throw error
    }
  }

  async migrate(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
    return this.batch(stmts, 'write')
  }

  async transaction(mode: TransactionMode = 'write') {
    const begin =
      mode === 'write' ? 'BEGIN IMMEDIATE' : mode === 'read' ? 'BEGIN TRANSACTION READONLY' : 'BEGIN DEFERRED'
    await this.db.exec(begin)
    return new WasmLibsqlTransaction(this.db, mode)
  }

  async executeMultiple(sql: string): Promise<void> {
    await this.db.exec(sql)
  }

  async sync(): Promise<never> {
    throw new Error('WASM libsql client does not support remote sync')
  }

  close(): void {
    void this.db.close()
  }

  get closed(): boolean {
    return !this.db.open
  }
}

export async function createWasmLibsqlClient(connectionUrl: string) {
  // Dynamic import: the WASM bundle spawns a Worker at module load, which
  // only works in a browser. Loading it lazily keeps every transitive
  // importer (platform index, stores, tests) safe in non-browser contexts.
  const { connect } = await import('@tursodatabase/database-wasm/bundle')
  const db = await connect(resolveOpfsPath(connectionUrl))
  return new WasmLibsqlClient(db) as unknown as Client
}
