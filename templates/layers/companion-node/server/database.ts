import pg from 'pg';
import type { MemoryDatabase } from '../worker/memory.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const database: MemoryDatabase = {
  prepare(sql) {
    let index = 0;
    const query = sql.replaceAll('?', () => `$${++index}`);
    return {
      bind(...values) {
        return {
          async first<T>() {
            const result = await pool.query(query, values);
            return (result.rows[0] ?? null) as T | null;
          },
          async run() {
            return pool.query(query, values);
          },
        };
      },
    };
  },
};
process.on('SIGTERM', () => {
  void pool.end();
});
