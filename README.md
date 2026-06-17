# 🎟️ Sistema de Tickets de Sorteo (Docker)

Reconstrucción del sistema que tenías en Lovable, pero **self-hosted, en Docker y preparado para aguantar miles de compras simultáneas**.

Recibe el webhook de compra de **GoHighLevel (GHL)**, crea **un ticket individual por cada número comprado** (si compran 1 → 1 ticket; si compran 35 → 35 tickets juntos), y manda **un email con todos los tickets de esa compra** usando **Brevo**. Cada ticket se dibuja sobre tu imagen-plantilla con su número encima.

---

## 🧱 Arquitectura (y por qué no se cae con 3000 compras a la vez)

```
GHL ──webhook──▶  [API]  ──encola──▶  [Redis cola]  ──▶  [Worker(s)]  ──▶  Brevo ──▶ 📧 cliente
                    │                                         │
                    └────────── escribe ─────▶ [PostgreSQL] ◀─┘
```

- **La API responde al webhook al instante**: solo guarda la compra y encola un trabajo. No manda el email en ese momento. Así, aunque lleguen 3000 webhooks de golpe, cada uno se resuelve en milisegundos y **ninguno se pierde**.
- **El worker** saca los trabajos de la cola y manda los emails al ritmo que permite Brevo (configurable). Si Brevo falla, **reintenta solo** con espera exponencial.
- **Idempotencia**: si GHL reenvía el mismo webhook (cosa habitual), el `order_id` evita crear tickets duplicados.
- **Números atómicos**: los números de ticket se reservan en bloque con una función SQL, sin colisiones aunque haya miles de inserciones a la vez.
- **Escala horizontal**: ¿más volumen? `docker compose up -d --scale worker=4`.

### Servicios del `docker-compose`
| Servicio | Qué hace |
|----------|----------|
| `db`     | PostgreSQL (datos) |
| `redis`  | Cola de envío (BullMQ) |
| `api`    | Webhook + API admin + búsqueda pública + sirve la web + imágenes de ticket |
| `worker` | Manda los emails desde la cola |

---

## 🚀 Puesta en marcha

### 1. Requisitos
- Docker y Docker Compose (Docker Desktop en Windows/Mac, o Docker en un VPS Linux).

### 2. Configura el `.env`
```bash
cp .env.example .env
```
Edita `.env` y rellena **como mínimo**:
- `BREVO_API_KEY` → tu API key de Brevo (*SMTP & API → API Keys*).
- `EMAIL_FROM` → un remitente con dominio **verificado en Brevo**.
- `WEBHOOK_SECRET` → un secreto largo (lo pondrás también en GHL).
- `ADMIN_PASSWORD` y `SESSION_SECRET` → claves para el panel admin.
- `PUBLIC_URL` → la URL pública real (ej. `https://tickets.tudominio.com`). Importante: es la que se usa en los emails y en las imágenes de los tickets.

### 3. Pon tu imagen de ticket
`assets/ticket-template.png` ya trae la plantilla **limpia** del *Viaje a Bali*. Sobre ella el sistema escribe 3 datos de cada compra: **Nombre**, **Correo** y **#Número** (el número va después del `#`), en las posiciones ya medidas:
```
TICKET_NAME_Y=514      # fila del nombre
TICKET_EMAIL_Y=581     # fila del correo
TICKET_NUMBER_Y=650    # fila del #número
TICKET_TEXT_COLOR=#946623     # bronce del ticket
TICKET_NUMBER_COLOR=#5b3f17   # número (más oscuro, resalta)
TICKET_MAX_WIDTH=900   # si un email es muy largo, la fuente se reduce sola
```
Si cambias de plantilla, pon la nueva en `assets/ticket-template.png` y ajusta las coordenadas `*_X`, `*_Y`, `*_SIZE` de cada campo (ver `.env.example`).
> Truco: tras arrancar, abre `PUBLIC_URL/t/<numero>.png` en el navegador para ver cómo queda y afinar las coordenadas.

### 4. Arranca (local)
```bash
docker compose up -d --build
```
- Web pública: `http://localhost:3000/`
- Panel admin: `http://localhost:3000/admin`
- Salud: `http://localhost:3000/health`

---

## 🟦 Desplegar en EasyPanel (recomendado para producción)

1. Sube esta carpeta a un repositorio **Git** (GitHub/GitLab) — o usa la opción de subida de EasyPanel.
2. En EasyPanel: **Create Project** → dentro, **+ Service** → tipo **Compose**.
3. Conecta el repo (o pega el contenido de `docker-compose.yml`). EasyPanel detecta los 4 servicios (db, redis, api, worker) y construye con el `Dockerfile`.
4. Pestaña **Environment** del servicio: pega tus variables (las de `.env.example`). Mínimo:
   `PUBLIC_URL`, `BREVO_API_KEY`, `EMAIL_FROM`, `WEBHOOK_SECRET`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `POSTGRES_PASSWORD`.
5. **Deploy.**
6. Pestaña **Domains**: añade tu dominio y mapéalo al servicio **`api`**, puerto **`3000`**. EasyPanel pone el HTTPS automático.
7. Pon ese mismo dominio en `PUBLIC_URL` (ej. `https://tickets.tudominio.com`) y vuelve a desplegar.

> Tu plantilla de ticket (`assets/ticket-template.png`) viaja en el repo, así que se incluye en el build. Para cambiarla, súbela al repo y redeploy.

### 📍 Tu webhook quedará en:
```
https://TU-DOMINIO/webhook/ghl
```
Esa es la URL que pones en GHL (ver sección siguiente).

---

## 🖥️ Desplegar en un VPS propio (con HTTPS automático)

La opción más simple y fiable. Incluye **Caddy** como reverse proxy con SSL
automático (Let's Encrypt). Todo arranca con un comando.

**1. VPS** con Ubuntu (Hetzner, DigitalOcean, Contabo…). Instala Docker:
```bash
curl -fsSL https://get.docker.com | sh
```

**2. Trae el código:**
```bash
git clone https://github.com/albinokeyt/sorteo-bali-tickets.git
cd sorteo-bali-tickets
```

**3. Crea el `.env`** (copia de `.env.example` y rellena Brevo + claves):
```bash
cp .env.example .env
nano .env
```
- `SITE_ADDRESS=tickets.tudominio.com`  ← tu dominio (Caddy saca el SSL solo)
- (Para probar sin dominio por IP: `SITE_ADDRESS=:80`)
- Deja `PUBLIC_URL=` vacío (se auto-detecta).

**4. DNS:** crea un registro **A** de `tickets.tudominio.com` → IP del VPS.

**5. Arranca** (con el override de VPS que añade Caddy):
```bash
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build
```

Listo. En `https://tickets.tudominio.com` está la web y en `/admin` el panel.
Caddy obtiene el certificado HTTPS solo y la app detecta el dominio automáticamente.

Comandos útiles:
```bash
docker compose -f docker-compose.yml -f docker-compose.vps.yml logs -f   # ver logs
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --scale worker=4   # más workers
docker compose -f docker-compose.yml -f docker-compose.vps.yml down      # parar
```

---

## 🔗 Conectar el webhook de GHL

En GHL, en el workflow que se dispara con la compra, añade una acción **Webhook** apuntando a:
```
POST  https://TU-DOMINIO/webhook/ghl
Header:  X-Webhook-Token: <el WEBHOOK_SECRET de tu .env>
```
(También vale `https://TU-DOMINIO/webhook/ghl?token=<WEBHOOK_SECRET>` si no puedes poner headers.)

Mapeo ya cuadrado con el webhook real del Sorteo Bali (campos en `.env`, soporta rutas con punto):
```
GHL_FIELD_EMAIL=email
GHL_FIELD_NAME=full_name
GHL_FIELD_QUANTITY=customData.TkComprados   # nº de tickets de ESA compra
GHL_FIELD_LINK=customData.LinkAcceso        # botón "Accede a tus productos" del email
GHL_FIELD_ORDER_ID=customData.purchase_id   # id único de compra (ver nota)
```
> **`TkComprados` = nº de tickets** de esa compra. Es lo que hace que "compran 35 → reciben 35 juntos".
> **`LinkAcceso`** se usa como botón de acceso a productos en el email y en la web pública.

#### ⚠️ ID único de compra (importante para no duplicar)
El webhook de GHL **no trae un id de compra** por defecto. Sin él:
- El sistema genera una clave **determinista** del payload → los **reintentos** de GHL no duplican. ✅
- Pero dos compras del mismo tamaño por la misma persona podrían colisionar en casos límite.

**Para idempotencia 100%** (y que "compran 1 y luego 35" funcione siempre), añade en la acción Webhook de GHL un campo en *Custom Data*:
```
purchase_id = {{order.id}}      (o {{transaction.id}} / un id de pago único)
```
Quedará en `customData.purchase_id` y el sistema lo usará automáticamente.

### Probar el webhook a mano
```bash
curl -X POST http://localhost:3000/webhook/ghl \
  -H "X-Webhook-Token: TU_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@correo.com","full_name":"Test","customData":{"TkComprados":"3","purchase_id":"PRUEBA-1","LinkAcceso":"https://coachingreal.es/?token=demo"}}'
```
Repite el mismo comando: verás `"duplicate": true` y **no** se crean tickets nuevos (idempotencia).

---

## 🛠️ Panel admin (`/admin`)
- Ver estadísticas (tickets, compras, enviados/pendientes/fallidos).
- Crear tickets manualmente (y mandar el email).
- Buscar tickets por email/nombre.
- **Reenviar** el email de una compra, o reenviar **todos los fallidos/pendientes**.
- **Resetear el sorteo** (borra tickets+compras y reinicia la numeración).
- **✉️ Editar el email** sin redesplegar (ver abajo).

## ✉️ Editar el email (desde `/admin`, sin redesplegar)
En el panel admin, sección **"Email que se envía"**, puedes cambiar:
- **Correo remitente** y **Nombre del remitente**
- **Asunto** y **Texto de vista previa (preview)**
- **URL del botón de WhatsApp**
- **El HTML completo** del email

Botones: **Guardar**, **Previsualizar** y **Enviar prueba** (a un correo que elijas).

Variables que puedes usar en el HTML / asunto / preview:
| Variable | Qué inserta |
|----------|-------------|
| `{{name}}` | nombre del comprador |
| `{{count}}` | nº de tickets de la compra |
| `{{product}}` | producto comprado (si se mapea desde GHL) |
| `{{confirmation_id}}` | código del primer ticket |
| `{{ticket_numbers}}` | lista de números (#101, #102…) |
| `{{link_acceso}}` | URL "Accede a tus productos" (LinkAcceso) |
| `{{whatsapp_url}}` | URL del botón de WhatsApp |
| `{{tickets_url}}` | página web para ver los tickets |
| `{{tickets_html}}` | la imagen de cada ticket (quítala si no quieres imágenes en el email) |
| `{{preheader}}` | texto de vista previa (oculto) |

> Los cambios se guardan en la base de datos: sobreviven a redeploys y se aplican al instante.

---

## ♻️ Resetear / limpiar la base de datos

**Opción A — desde el panel admin:** botón "Resetear sorteo".

**Opción B — por API:**
```bash
curl -X POST http://localhost:3000/api/admin/reset \
  -H "Authorization: Bearer <token-del-login>" \
  -H "Content-Type: application/json" \
  -d '{"raffle":"viaje-bali","confirm":"RESET"}'
```

**Opción C — borrar TODO de raíz** (incluye datos y vuelve a crear el esquema):
```bash
docker compose down -v   # ⚠️ borra el volumen de Postgres
docker compose up -d
```

El reset borra tickets y compras del sorteo y **reinicia el contador a 0**, además de limpiar el cache de imágenes.

---

## 📈 Escalado y rendimiento
- **Recibir compras**: la API solo hace un INSERT + encolar → soporta miles concurrentes sin esfuerzo.
- **Enviar emails**: ajusta el ritmo con `EMAIL_RATE_PER_SEC` (según tu plan de Brevo) y añade workers:
  ```bash
  docker compose up -d --scale worker=4
  ```
- **Reintentos**: `EMAIL_MAX_ATTEMPTS` controla cuántas veces se reintenta un email fallido.
- En producción pon un reverse proxy (Nginx/Caddy/Traefik) con HTTPS delante de la `api`, y apunta `PUBLIC_URL` a ese dominio.

---

## 🗂️ Estructura
```
ticket-system/
├─ docker-compose.yml      # los 4 servicios
├─ Dockerfile              # build (frontend + backend en una imagen)
├─ .env.example            # copia a .env y rellena
├─ db/init.sql             # esquema + funciones (reserva atómica, reset)
├─ assets/ticket-template.png  # TU plantilla del ticket
├─ backend/                # API (Fastify) + worker (BullMQ)
│  └─ src/
│     ├─ server.ts         # API + sirve la web
│     ├─ worker.ts         # envío de emails
│     ├─ routes/           # webhook, admin, público, imagen
│     └─ lib/              # tickets, imagen, brevo, plantilla email, auth
└─ frontend/               # React (búsqueda pública + panel admin)
```

---

## 🧩 Notas
- El sorteo por defecto es `viaje-bali` (se crea solo). Para varios sorteos, inserta más filas en `raffles` y manda `raffle` en el webhook/admin.
- Los emails referencian las imágenes desde tu propio servidor (`/t/<número>.png`), generadas bajo demanda y cacheadas en disco (`data/ticket-cache`).
- Datos persistentes en los volúmenes Docker `pgdata` y `redisdata`.
