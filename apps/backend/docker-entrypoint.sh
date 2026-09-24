#!/bin/sh
# Запуск API в контейнере: миграции базы данных, демонстрационные данные (если база пуста), сервер
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Применение миграций базы данных..."
  prisma migrate deploy
fi

if [ "${SEED_DEMO:-false}" = "true" ]; then
  echo "Заполнение демонстрационными данными (выполняется только для пустой базы)..."
  node dist/seed/seed.js
fi

exec "$@"
