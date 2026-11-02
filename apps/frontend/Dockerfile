# syntax=docker/dockerfile:1.7
# Веб-интерфейс (React + Vite), раздаётся nginx с проксированием /api на backend.
# Контекст сборки — корень репозитория:
#   docker build -f apps/frontend/Dockerfile .

# ---------------------------------------------------------------- манифесты без номера версии
# semantic-release меняет поле version в package.json и package-lock.json при каждом
# релизе. Если копировать файлы как есть, npm ci переустанавливает все зависимости
# после каждого релиза. Здесь версия обнуляется: пока не меняются зависимости,
# содержимое одинаковое, и слои с npm ci берутся из кэша.
FROM node:22-bookworm-slim AS manifests
WORKDIR /app
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

# ---------------------------------------------------------------- сборка
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=manifests /app/package.json /app/package-lock.json ./
COPY --from=manifests /app/apps/backend/package.json apps/backend/
COPY --from=manifests /app/apps/frontend/package.json apps/frontend/
RUN --mount=type=cache,target=/root/.npm \
  npm ci --workspace apps/frontend --include-workspace-root
COPY apps/frontend apps/frontend
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build --workspace apps/frontend

FROM nginx:1.27-alpine AS runtime
# Адрес API и DNS-резолвер подставляются в шаблон конфигурации при запуске контейнера
ENV API_UPSTREAM=http://backend:3000 \
    NGINX_RESOLVER=127.0.0.11
COPY apps/frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
