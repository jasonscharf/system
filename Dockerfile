#
# This Dockerfile builds both production and development images.
#
# Notes:
# - Development images have dev-only bind mounts and config overlaid via compose
# - Each image currently contains all packages, as they are not shipped outside of the repo
# - Further hardening and production prep will occur as the repo stabilizes
#

#
# Base
#
FROM node:20-slim AS base

WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml /app
COPY .yarn .yarn

RUN corepack enable \
    && corepack prepare yarn@4.1.0 --activate \
    && yarn --version \
    && yarn install

RUN yarn build


#
# Dev / Build container
#
FROM base AS dev

ENV NODE_ENV=development
CMD ["tsc", "-b", "-w"]


#
# Test
#
FROM base AS test

WORKDIR /app
ENV NODE_ENV=production

COPY --from=base /app /app
RUN yarn install


#
# Worker
#
FROM base AS worker

WORKDIR /app
ENV NODE_ENV=production

COPY --from=base /app /app
RUN yarn
ENTRYPOINT ["node", "packages/worker/dist/index.js"]


#
# Server  —  WebSocket on :8080, HTTP auth on :8081
#
FROM base AS server

WORKDIR /app
ENV NODE_ENV=production

COPY --from=base /app /app
RUN yarn

EXPOSE 8080 8081

# Health-check hits the HTTP health endpoint on :8081 (returns {"ok":true})
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:8081/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "packages/sandbox-server/dist/index.js"]


#
# Web builder  —  Vite production build
#
# VITE_* vars are NOT baked in; the app derives WS/auth URLs from
# window.location at runtime so the same image works in every environment.
#
FROM base AS web-build

WORKDIR /app
ENV NODE_ENV=production

COPY --from=base /app /app
RUN yarn workspace @system/sandbox-web build


#
# Web  —  nginx static files + reverse proxy to server
#
FROM nginx:1.27-alpine AS web

COPY --from=web-build /app/packages/sandbox-web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost/healthz || exit 1
