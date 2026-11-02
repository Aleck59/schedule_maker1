# syntax=docker/dockerfile:1.7
# REST API (NestJS + Prisma) вместе с вычислительным модулем на Python: решатель
# OR-Tools CP-SAT и распознавание сканов учебных планов (Tesseract OCR).
# Контекст сборки — корень репозитория:
#   docker build -f apps/backend/Dockerfile .
#
# Порядок шагов подобран так, чтобы кэш слоёв переиспользовался между сборками:
# сначала редко меняющееся (системные пакеты, зависимости), в конце — исходники и
# номер версии. Иначе каждый релиз создаёт новые копии слоёв по сотне мегабайт.

FROM node:22-bookworm-slim AS node

FROM node AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV PATH=/app/node_modules/.bin:$PATH

# ---------------------------------------------------------------- манифесты без номера версии
# semantic-release меняет поле version в package.json и package-lock.json при каждом
# релизе. Если копировать файлы как есть, npm ci переустанавливает все зависимости
# после каждого релиза. Здесь версия обнуляется: пока не меняются зависимости,
# содержимое одинаковое, и слои с npm ci берутся из кэша.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN node -e ' \
  const fs = require("fs"); \
  const write = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2) + "\n"); \
  const dirs = ["", "apps/backend", "apps/frontend"]; \
  for (const dir of dirs) { \
    const file = (dir ? dir + "/" : "") + "package.json"; \
    const pkg = JSON.parse(fs.readFileSync(file, "utf8")); \
    pkg.version = "0.0.0"; write(file, pkg); \
  } \
  const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8")); \
  lock.version = "0.0.0"; \
  for (const dir of dirs) if (lock.packages && lock.packages[dir]) lock.packages[dir].version = "0.0.0"; \
  write("package-lock.json", lock);'

# ---------------------------------------------------------------- сборка API
FROM base AS build
COPY --from=manifests /app/package.json /app/package-lock.json ./
COPY --from=manifests /app/apps/backend/package.json apps/backend/
COPY --from=manifests /app/apps/frontend/package.json apps/frontend/
RUN --mount=type=cache,target=/root/.npm \
  npm ci --workspace apps/backend --include-workspace-root
COPY apps/backend apps/backend
WORKDIR /app/apps/backend
RUN prisma generate && npm run build

# ---------------------------------------------------------------- production-зависимости API
FROM base AS deps
COPY --from=manifests /app/package.json /app/package-lock.json ./
COPY --from=manifests /app/apps/backend/package.json apps/backend/
COPY --from=manifests /app/apps/frontend/package.json apps/frontend/
RUN --mount=type=cache,target=/root/.npm \
  npm ci --omit=dev --workspace apps/backend --include-workspace-root
COPY apps/backend/prisma apps/backend/prisma
# После генерации клиента удаляется то, что при работе не нужно (~180 МБ):
# - карты исходников *.map;
# - копии движка запросов в пакетах prisma и @prisma/engines: и клиент, и CLI берут
#   копию из .prisma/client (путь задан в PRISMA_QUERY_ENGINE_LIBRARY в образе запуска;
#   без него CLI попытался бы скачать движок при старте контейнера);
# - WebAssembly-движки для edge-окружений и других СУБД (клиент работает через
#   нативную библиотеку для PostgreSQL).
RUN cd apps/backend && prisma generate \
  && cd /app \
  && find node_modules -name '*.map' -type f -delete \
  && rm -f node_modules/prisma/libquery_engine-* \
           node_modules/@prisma/engines/libquery_engine-* \
           node_modules/@prisma/client/runtime/query_engine_bg.* \
           node_modules/@prisma/client/runtime/query_compiler_bg.* \
  && test -f node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node \
  && test -n "$(ls node_modules/@prisma/engines/schema-engine-*)"

# ---------------------------------------------------------------- Python-окружение модуля
FROM base AS engine
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*
COPY apps/solver/requirements.txt /tmp/requirements.txt
# Тесты внутри пакетов (pandas, numpy и др., ~60 МБ) и сам pip при работе не нужны.
# Байт-код .pyc оставлен: без него каждый запуск решателя заново компилировал бы модули.
RUN --mount=type=cache,target=/root/.cache/pip \
  python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --disable-pip-version-check -r /tmp/requirements.txt \
  && find /opt/venv/lib -depth -type d -name tests -prune -exec rm -rf {} + \
  && /opt/venv/bin/python -m pip uninstall -y -q pip

# ---------------------------------------------------------------- образ запуска
# Основа — debian slim с одним бинарником node: npm, yarn и corepack при работе не нужны.
FROM debian:bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates python3 tesseract-ocr tesseract-ocr-rus \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 1000 node \
  && useradd --uid 1000 --gid node --shell /bin/sh --create-home node
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ENV NODE_ENV=production \
    PATH=/app/node_modules/.bin:$PATH \
    CHECKPOINT_DISABLE=1 \
    PORT=3000 \
    PYTHON_BIN=/opt/venv/bin/python \
    ENGINE_DIR=/app/engine \
    PYTHONDONTWRITEBYTECODE=1 \
    PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node
# Крупные слои — в порядке от самого стабильного к самому изменчивому
COPY --from=engine /opt/venv /opt/venv
COPY --from=deps /app/node_modules /app/node_modules
COPY apps/backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY apps/backend/prisma /app/apps/backend/prisma
COPY apps/solver/app /app/engine/app
COPY --from=build /app/apps/backend/dist /app/apps/backend/dist
# Настоящие package.json (с номером версии) — для appVersion() и разрешения модулей
COPY package.json /app/package.json
COPY apps/backend/package.json /app/apps/backend/package.json
# Проверка: модуль импортируется, OR-Tools и Tesseract (rus) доступны
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && node --version \
  && test -f "$PRISMA_QUERY_ENGINE_LIBRARY" \
  && cd /app/engine && /opt/venv/bin/python -m app info
# Номер версии — последним: его смена не должна пересоздавать слои выше
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
WORKDIR /app/apps/backend
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
