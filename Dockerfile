#
# Multi-stage Dockerfile for all Tern services.
#
# Targets:
#   base       — deps installed + all packages compiled (shared layer)
#   dev        — development / TypeScript watch mode
#   test       — test runner
#   worker     — @system/worker process
#   server     — sandbox-server (WS :8080, HTTP :8081)
#   web-build  — Vite production build of sandbox-web
#   web        — nginx serving web assets + reverse proxy to server
#
# Build arguments:
#   none required — VITE_* vars are NOT baked in so one image serves every env.
#

# ── Base ──────────────────────────────────────────────────────────────────────
FROM node:22-slim AS base

WORKDIR /app

# Activate Yarn 4 via Corepack before any yarn commands.
# .yarn/cache is gitignored and not needed — Corepack fetches the binary.
RUN corepack enable && corepack prepare yarn@4.1.0 --activate

# Copy manifests first so the install layer is cached unless deps change.
COPY package.json yarn.lock .yarnrc.yml ./

# Copy all workspace source (node_modules, dist/, .git excluded by .dockerignore)
COPY packages/ packages/

# Install workspace dependencies then compile every TypeScript package.
RUN yarn install --frozen-lockfile
RUN yarn build


# ── Dev / Build container ─────────────────────────────────────────────────────
FROM base AS dev

ENV NODE_ENV=development
CMD ["tsc", "-b", "-w"]


# ── Test ──────────────────────────────────────────────────────────────────────
FROM base AS test

ENV NODE_ENV=production
CMD ["yarn", "test"]


# ── Worker ────────────────────────────────────────────────────────────────────
FROM base AS worker

ENV NODE_ENV=production
ENTRYPOINT ["node", "packages/worker/dist/index.js"]


# ── Server  —  WebSocket on :8080, HTTP auth on :8081 ────────────────────────
FROM base AS server

ENV NODE_ENV=production
EXPOSE 8080 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:8081/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "packages/sandbox-server/dist/index.js"]


# ── Web builder  —  Vite production build ────────────────────────────────────
#
# VITE_* env vars are NOT baked in: the app derives WS/auth URLs from
# window.location at runtime so the same image works across all environments.
#
FROM base AS web-build

RUN yarn workspace @system/sandbox-web build


# ── Web  —  nginx static files + reverse proxy ───────────────────────────────
FROM nginx:1.27-alpine AS web

COPY --from=web-build /app/packages/sandbox-web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost/healthz || exit 1
