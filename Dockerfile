# Stage 1: Build TypeScript
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# Stage 2: Production runtime (Node.js + Playwright Chromium + Python EasyOCR)
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/app/data \
    OCR_USE_WSL=false \
    PYTHON_BIN=/opt/venv/bin/python \
    PLAYWRIGHT_HEADLESS=true

WORKDIR /app

# Install Python & system dependencies needed for EasyOCR + OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    libgl1 \
    libglib2.0-0 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python EasyOCR in an isolated virtualenv
COPY python/requirements.txt ./python/requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -r ./python/requirements.txt

# Install production Node dependencies + Playwright Chromium + OS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# Copy built application, frontend, and Python OCR script
COPY --from=builder /app/dist ./dist
COPY public ./public
COPY python ./python
COPY .env.example ./.env.example

RUN mkdir -p /app/data/downloads /app/data/captchas /app/data/logs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server.js"]

