// Lógica de creación de tickets, segura ante concurrencia y reintentos.
import type { PoolClient } from "pg";
import { pool, tx } from "../db";

export type CreatePurchaseInput = {
  raffleSlug: string;
  externalOrderId: string;
  email: string;
  name: string;
  quantity: number;
  linkAcceso?: string | null;
  product?: string | null;
  rawPayload?: unknown;
};

export type CreatePurchaseResult = {
  purchaseId: string;
  duplicate: boolean; // true si esa compra ya existía (idempotencia)
  ticketNumbers: number[];
};

function ticketCode(seq: number): string {
  return `TK-${String(seq).padStart(6, "0")}`;
}

// Crea una compra + sus N tickets de forma atómica e idempotente.
// Si el mismo externalOrderId ya existe (GHL reintentó el webhook),
// NO duplica nada y devuelve duplicate=true.
export async function createPurchaseWithTickets(
  input: CreatePurchaseInput
): Promise<CreatePurchaseResult> {
  return tx(async (client: PoolClient) => {
    const raffle = await client.query<{ id: string }>(
      "SELECT id FROM raffles WHERE slug = $1 AND active = true",
      [input.raffleSlug]
    );
    if (raffle.rowCount === 0) {
      throw new Error(`Sorteo no encontrado o inactivo: ${input.raffleSlug}`);
    }
    const raffleId = raffle.rows[0].id;

    // Inserta la compra; si ya existe (mismo order_id) no hace nada.
    const ins = await client.query<{ id: string }>(
      `INSERT INTO purchases (raffle_id, external_order_id, email, name, quantity, link_acceso, product, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (raffle_id, external_order_id) DO NOTHING
       RETURNING id`,
      [
        raffleId,
        input.externalOrderId,
        input.email.toLowerCase().trim(),
        input.name.trim(),
        input.quantity,
        input.linkAcceso?.trim() || null,
        input.product?.trim() || null,
        input.rawPayload ? JSON.stringify(input.rawPayload) : null,
      ]
    );

    if (ins.rowCount === 0) {
      // Compra duplicada: recuperamos la existente y sus números.
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM purchases WHERE raffle_id = $1 AND external_order_id = $2",
        [raffleId, input.externalOrderId]
      );
      const pid = existing.rows[0].id;
      const nums = await client.query<{ ticket_sequential_number: string }>(
        "SELECT ticket_sequential_number FROM tickets WHERE purchase_id = $1 ORDER BY ticket_sequential_number",
        [pid]
      );
      return {
        purchaseId: pid,
        duplicate: true,
        ticketNumbers: nums.rows.map((r) => Number(r.ticket_sequential_number)),
      };
    }

    const purchaseId = ins.rows[0].id;

    // Reserva un bloque contiguo de N números de forma atómica.
    const reserve = await client.query<{ reserve_ticket_numbers: string }>(
      "SELECT reserve_ticket_numbers($1, $2)",
      [raffleId, input.quantity]
    );
    const first = Number(reserve.rows[0].reserve_ticket_numbers);

    const numbers: number[] = [];
    const values: string[] = [];
    const params: any[] = [];
    let p = 0;
    for (let i = 0; i < input.quantity; i++) {
      const seq = first + i;
      numbers.push(seq);
      values.push(
        `($${++p}, $${++p}, $${++p}, $${++p}, $${++p}, $${++p})`
      );
      params.push(
        raffleId,
        purchaseId,
        ticketCode(seq),
        seq,
        input.email.toLowerCase().trim(),
        input.name.trim()
      );
    }

    await client.query(
      `INSERT INTO tickets
         (raffle_id, purchase_id, ticket_number, ticket_sequential_number, email, name)
       VALUES ${values.join(", ")}`,
      params
    );

    return { purchaseId, duplicate: false, ticketNumbers: numbers };
  });
}

// Datos de una compra + sus tickets, para el worker que manda el email.
export async function getPurchaseForEmail(purchaseId: string) {
  const p = await pool.query(
    `SELECT pu.id, pu.email, pu.name, pu.quantity, pu.email_status, pu.link_acceso, pu.product,
            r.name AS raffle_name, r.slug AS raffle_slug
       FROM purchases pu JOIN raffles r ON r.id = pu.raffle_id
      WHERE pu.id = $1`,
    [purchaseId]
  );
  if (p.rowCount === 0) return null;
  const tickets = await pool.query(
    `SELECT id, ticket_number, ticket_sequential_number
       FROM tickets WHERE purchase_id = $1 AND deleted_at IS NULL
      ORDER BY ticket_sequential_number`,
    [purchaseId]
  );
  return {
    purchase: p.rows[0],
    tickets: tickets.rows.map((t) => ({
      id: t.id,
      code: t.ticket_number,
      number: Number(t.ticket_sequential_number),
    })),
  };
}

export async function markPurchaseEmail(
  purchaseId: string,
  status: "sent" | "failed",
  error?: string
) {
  await pool.query(
    `UPDATE purchases
        SET email_status = $2, email_error = $3,
            sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
      WHERE id = $1`,
    [purchaseId, status, error ?? null]
  );
}
