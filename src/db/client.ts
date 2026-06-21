import { Pool } from "pg";
import { config } from "../config";
import { logger } from "../utils/logger";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  logger.error("Unexpected error on idle pg client", { error: err.message });
});

export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<T[]> {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug("Query executed", { duration, rows: result.rowCount });
    return result.rows;
  } catch (err: any) {
    logger.error("Query failed", { error: err.message, text });
    throw err;
  }
}

export async function queryOne<T = any>(
  text: string,
  params?: any[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}
