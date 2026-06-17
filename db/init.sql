-- ============================================================
--  Esquema del sistema de tickets de sorteo
--  Se ejecuta automáticamente la PRIMERA vez que arranca Postgres.
--  Para resetear datos sin borrar el esquema usa la función reset_raffle()
--  o el endpoint admin /api/admin/reset.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- para gen_random_uuid()

-- --- Ajustes editables (email, remitente, etc.) -------------
-- Clave/valor para poder editar el email desde el panel admin
-- SIN redesplegar. Los valores por defecto los siembra la app al arrancar.
CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value text
);

-- --- Sorteos / campañas -------------------------------------
-- Cada sorteo tiene su propio contador de números, así puedes
-- resetear uno sin tocar los demás.
CREATE TABLE IF NOT EXISTS raffles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text UNIQUE NOT NULL,
  name           text NOT NULL,
  ticket_counter bigint NOT NULL DEFAULT 0,  -- último número asignado
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- --- Compras ------------------------------------------------
-- external_order_id es la clave de idempotencia: si GHL reintenta
-- el webhook con el mismo order_id, NO se duplican tickets.
CREATE TABLE IF NOT EXISTS purchases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raffle_id        uuid NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
  external_order_id text NOT NULL,
  email            text NOT NULL,
  name             text NOT NULL,
  quantity         int  NOT NULL CHECK (quantity > 0),
  email_status     text NOT NULL DEFAULT 'pending', -- pending | sent | failed
  email_error      text,
  link_acceso      text,        -- LinkAcceso de GHL: botón "Accede a tus productos"
  product          text,        -- producto comprado (opcional, para {{product}})
  raw_payload      jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  UNIQUE (raffle_id, external_order_id)
);

-- --- Tickets individuales -----------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raffle_id                uuid NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
  purchase_id              uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  ticket_number            text NOT NULL,          -- código tipo TK-000123
  ticket_sequential_number bigint NOT NULL,        -- número visible del sorteo
  email                    text NOT NULL,
  name                     text NOT NULL,
  status                   text NOT NULL DEFAULT 'active',
  is_annulled              boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz,
  UNIQUE (raffle_id, ticket_sequential_number)
);

CREATE INDEX IF NOT EXISTS idx_tickets_email   ON tickets (lower(email));
CREATE INDEX IF NOT EXISTS idx_tickets_raffle  ON tickets (raffle_id);
CREATE INDEX IF NOT EXISTS idx_tickets_purchase ON tickets (purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchases_email ON purchases (lower(email));

-- --- Reserva atómica de números -----------------------------
-- Reserva un bloque de N números para un sorteo de forma segura
-- aunque lleguen miles de compras a la vez. Devuelve el primer número.
CREATE OR REPLACE FUNCTION reserve_ticket_numbers(p_raffle uuid, n int)
RETURNS bigint AS $$
DECLARE
  first_num bigint;
BEGIN
  UPDATE raffles
     SET ticket_counter = ticket_counter + n
   WHERE id = p_raffle
  RETURNING ticket_counter - n + 1 INTO first_num;
  RETURN first_num;
END;
$$ LANGUAGE plpgsql;

-- --- Reset de un sorteo -------------------------------------
-- Borra compras y tickets de UN sorteo y reinicia su contador a 0.
CREATE OR REPLACE FUNCTION reset_raffle(p_slug text)
RETURNS void AS $$
DECLARE
  r_id uuid;
BEGIN
  SELECT id INTO r_id FROM raffles WHERE slug = p_slug;
  IF r_id IS NULL THEN
    RAISE EXCEPTION 'Sorteo no encontrado: %', p_slug;
  END IF;
  DELETE FROM tickets   WHERE raffle_id = r_id;
  DELETE FROM purchases WHERE raffle_id = r_id;
  UPDATE raffles SET ticket_counter = 0 WHERE id = r_id;
END;
$$ LANGUAGE plpgsql;

-- --- Sorteo por defecto -------------------------------------
INSERT INTO raffles (slug, name)
VALUES ('viaje-bali', 'Viaje a Bali · Jorge Darek')
ON CONFLICT (slug) DO NOTHING;
