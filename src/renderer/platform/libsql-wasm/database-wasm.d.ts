declare module '@tursodatabase/database-wasm/bundle' {
  export interface Database {
    open: boolean
    all(sql: string, ...args: unknown[]): Promise<Record<string, unknown>[]>
    run(sql: string, ...args: unknown[]): Promise<{ changes: number; lastInsertRowid: number }>
    exec(sql: string): Promise<void>
    close(): Promise<void>
  }

  export function connect(path: string, opts?: Record<string, unknown>): Promise<Database>
}
