# syntax=docker/dockerfile:1.7
# REST API (NestJS + Prisma). Контекст сборки — корень репозитория:
#   docker build -f apps/backend/Dockerfile .

FROM node:25-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV PATH=/app/node_modules/.bin:$PATH

# ---------------------------------------------------------------- сборка
FROM base AS build
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci --workspace apps/backend --include-workspace-root
COPY apps/backend apps/backend
WORKDIR /app/apps/backend
RUN prisma generate && npm run build

# ---------------------------------------------------------------- production-зависимости
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci --omit=dev --workspace apps/backend --include-workspace-root && npm cache clean --force
COPY apps/backend/prisma apps/backend/prisma
RUN cd apps/backend && prisma generate

# ---------------------------------------------------------------- образ запуска
FROM base AS runtime
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1 \
    APP_VERSION=$APP_VERSION \
    PORT=3000
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/package.json /app/package.json
COPY --from=deps /app/apps/backend/package.json /app/apps/backend/package.json
COPY --from=deps /app/apps/backend/prisma /app/apps/backend/prisma
COPY --from=build /app/apps/backend/dist /app/apps/backend/dist
COPY apps/backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
WORKDIR /app/apps/backend
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
