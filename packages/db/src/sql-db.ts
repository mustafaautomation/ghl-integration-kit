/** The slice of D1 this package uses. Keeps the adapter off the Workers type package. */
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface SqlDb {
  prepare(query: string): SqlStatement;
}
