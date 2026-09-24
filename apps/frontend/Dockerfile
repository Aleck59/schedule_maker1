# syntax=docker/dockerfile:1.7
# Веб-интерфейс (React + Vite), раздаётся nginx с проксированием /api на backend.
# Контекст сборки — корень репозитория:
#   docker build -f apps/frontend/Dockerfile .

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci --workspace apps/frontend --include-workspace-root
COPY apps/frontend apps/frontend
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build --workspace apps/frontend

FROM nginx:1.29-alpine AS runtime
# Адрес API и DNS-резолвер подставляются в шаблон конфигурации при запуске контейнера
ENV API_UPSTREAM=http://backend:3000 \
    NGINX_RESOLVER=127.0.0.11
COPY apps/frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
