declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    prepare(sql: string): {
      get(key: string): { value?: string | Uint8Array } | undefined;
    };
    close(): void;
  }
}
