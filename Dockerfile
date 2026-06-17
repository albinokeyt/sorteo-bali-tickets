# ---------- Stage 1: build del frontend (Vite/React) ----------
FROM node:20-bookworm-slim AS frontend
WORKDIR /web
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build   # genera /web/dist

# ---------- Stage 2: backend + frontend servido ----------
FROM node:20-bookworm-slim
# Fuentes para dibujar el número sobre el ticket (sharp + SVG)
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/package.json ./
RUN npm install --omit=dev
COPY backend/tsconfig.json ./
COPY backend/src ./src

# Copia el frontend ya compilado
COPY --from=frontend /web/dist /app/public

RUN mkdir -p /app/cache /app/assets
ENV NODE_ENV=production STATIC_DIR=/app/public
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/server.ts"]
