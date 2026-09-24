# syntax=docker/dockerfile:1.7
# Сервис оптимизации расписания (FastAPI + Google OR-Tools CP-SAT).
# Контекст сборки — каталог apps/solver:
#   docker build apps/solver

FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app app
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN useradd --system --uid 10001 solver
USER solver
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
