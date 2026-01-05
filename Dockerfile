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
