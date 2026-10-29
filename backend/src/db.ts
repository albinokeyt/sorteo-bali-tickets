// Pool de conexiones a Postgres. Un pool aguanta perfectamente
// miles de inserciones concurrentes reutilizando conexiones.
import pg from "pg";
import { config } from "./config";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.db.poolMax, // conexiones simultáneas; sube si escalas la API horizontalmente
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Una consulta colgada no debe retener una conexión para siempre.
  statement_timeout: config.db.statementTimeoutMs > 0 ? config.db.statementTimeoutMs : undefined,
});

pool.on("error", (err) => {
  console.error("[db] error inesperado en el pool:", err);
});

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

// Ejecuta una función dentro de una transacción.
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rbErr: any) {
      // Conexión rota: se descarta en vez de devolverla al pool.
      broken = rbErr;
    }
    throw err;
  } finally {
    client.release(broken);
  }
}

// Migraciones idempotentes que init.sql no aplica a una BD ya creada
// (init.sql solo se ejecuta la primera vez que arranca Postgres).
export async function runMigrations(): Promise<void> {
  const stmts = [
    // /t/:num busca por número sin raffle_id → sin este índice era un seq scan
    // por cada imagen abierta.
    `CREATE INDEX IF NOT EXISTS idx_tickets_seq ON tickets (ticket_sequential_number)`,
    // Panel (cola/estadísticas) y barrido de pendientes del worker.
    `CREATE INDEX IF NOT EXISTS idx_purchases_status_created ON purchases (email_status, created_at)`,
  ];
  for (const s of stmts) await pool.query(s);
}
