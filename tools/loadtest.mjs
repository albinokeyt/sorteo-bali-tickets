// Prueba de carga: dispara muchas "compras" contra el webhook para verificar
// que la app no se cae y que la cola procesa todo.
//
// ⚠️ Úsalo SOLO con EMAIL_DRY_RUN=true en el servidor (no envía emails reales).
//
// Uso:
//   node tools/loadtest.mjs <BASE_URL> <WEBHOOK_TOKEN> [burst]
// Ejemplo:
//   node tools/loadtest.mjs https://tu-dominio xKEY 600
//
// Escenario base: 1 compra de 560 + 1 de 30 + 10 de 1  (+ "burst" compras de 1).

const base = (process.argv[2] || "").replace(/\/$/, "");
const token = process.argv[3] || "";
const burst = Number(process.argv[4] || 0);
if (!base || !token) {
  console.error("Uso: node tools/loadtest.mjs <BASE_URL> <TOKEN> [burst]");
  process.exit(1);
}

const stamp = Date.now();
const jobs = [];
jobs.push({ qty: 560, tag: "big560" });
jobs.push({ qty: 30, tag: "pack30" });
for (let i = 0; i < 10; i++) jobs.push({ qty: 1, tag: `single${i}` });
for (let i = 0; i < burst; i++) jobs.push({ qty: 1, tag: `burst${i}` });

const url = `${base}/webhook/ghl?token=${encodeURIComponent(token)}`;

function payload(j, idx) {
  return {
    email: `loadtest+${stamp}_${idx}@example.com`,
    full_name: `Carga ${idx}`,
    customData: {
      TkComprados: String(j.qty),
      purchase_id: `LOAD-${stamp}-${idx}`,
      LinkAcceso: "https://example.com/acceso",
    },
  };
}

let ok = 0, dup = 0, err = 0;
const errors = [];
const CONCURRENCY = 50; // peticiones simultáneas
const t0 = Date.now();

async function fire(j, idx) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload(j, idx)),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      if (data.duplicate) dup++;
      else ok++;
    } else {
      err++;
      if (errors.length < 5) errors.push(`HTTP ${res.status}: ${JSON.stringify(data)}`);
    }
  } catch (e) {
    err++;
    if (errors.length < 5) errors.push(String(e));
  }
}

// Pool de concurrencia
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const i = next++;
    await fire(jobs[i], i);
  }
}

const totalTickets = jobs.reduce((a, j) => a + j.qty, 0);
console.log(`Disparando ${jobs.length} compras (${totalTickets} tickets) contra ${base} ...`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log("\n===== RESULTADO =====");
console.log(`Compras enviadas: ${jobs.length}`);
console.log(`  nuevas:      ${ok}`);
console.log(`  duplicadas:  ${dup}`);
console.log(`  errores:     ${err}`);
console.log(`Tiempo total de ingestión: ${secs}s  (la API debe aceptarlas casi al instante)`);
if (errors.length) console.log("Ejemplos de error:\n - " + errors.join("\n - "));
console.log("\nAhora mira el panel /admin -> 'Estado de envíos' para ver la cola vaciarse.");
