# ── Build stage: install deps + build web client ────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY web/ ./web/
COPY src/ ./src/

RUN npm run build:web

# ── Production stage: minimal runtime ──────────────────
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/web/dist ./web/dist
COPY src/ ./src/
COPY tsconfig.json ./

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=postgresql://arena:arena@db:5432/arena01

CMD ["npx", "tsx", "src/server.ts"]
