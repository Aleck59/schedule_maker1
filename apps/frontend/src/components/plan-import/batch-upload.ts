import { useSyncExternalStore } from 'react';
import { api, ApiError } from '@/lib/api';
import type { BatchUploadResult, CurriculumScan } from './types';

/** Файл пакета на стороне браузера: пока он не отправлен, на сервере его ещё нет */
export interface LocalBatchFile {
  key: string;
  name: string;
  size: number;
  /** queued — ждёт очереди, uploading — отправляется, sent — на сервере, error — не отправился */
  phase: 'queued' | 'uploading' | 'sent' | 'error';
  /** Доля отправленных байт 0…1 */
  uploaded: number;
  scanId?: string;
  error?: string;
}

interface State {
  batchId: string | null;
  running: boolean;
  files: LocalBatchFile[];
}

/**
 * Последовательная пакетная загрузка учебных планов. Файлы отправляются строго по одному:
 * следующий уходит только после того, как сервер обработал предыдущий (прочитал и создал план).
 * Состояние живёт вне компонента — загрузка не прерывается при переходах по страницам приложения.
 */
let state: State = { batchId: null, running: false, files: [] };
const listeners = new Set<() => void>();
let raw: File[] = [];

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
function patchFile(key: string, patch: Partial<LocalBatchFile>) {
  set({ files: state.files.map((f) => (f.key === key ? { ...f, ...patch } : f)) });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ждать, пока сервер закончит обработку файла (чтение, распознавание, создание плана) */
async function waitProcessed(batchId: string, scanId: string) {
  let delay = 400;
  for (;;) {
    try {
      const list = await api.get<CurriculumScan[]>('/curriculum-scans', { batchId });
      const scan = list.find((s) => s.id === scanId);
      if (!scan || scan.status !== 'PROCESSING') return;
    } catch {
      /* временная ошибка сети — повторим */
    }
    await sleep(delay);
    delay = Math.min(1500, delay + 150);
  }
}

async function run(autoApply: boolean) {
  let failed = 0;
  for (const [i, file] of raw.entries()) {
    const key = state.files[i].key;
    patchFile(key, { phase: 'uploading', uploaded: 0 });
    const form = new FormData();
    form.append('files', file);
    form.append('autoApply', String(autoApply));
    // Сколько файлов дойдёт до сервера: без уже не отправленных — уведомление придёт после последнего
    form.append('batchTotal', String(raw.length - failed));
    if (state.batchId) form.append('batchId', state.batchId);
    try {
      const res = await api.uploadWithProgress<BatchUploadResult>('/curriculum-scans/batch', form, (fraction) =>
        patchFile(key, { uploaded: fraction }),
      );
      const scanId = res.scans[0]?.id;
      if (!state.batchId) set({ batchId: res.batchId });
      patchFile(key, { phase: 'sent', uploaded: 1, scanId });
      if (scanId) await waitProcessed(res.batchId, scanId);
    } catch (e) {
      failed++;
      patchFile(key, { phase: 'error', error: e instanceof ApiError ? e.message : 'Не удалось отправить файл' });
    }
  }
  set({ running: false });
}

export const batchUpload = {
  get state() {
    return state;
  },
  /** Начать загрузку пакета; номер пакета сервер выдаёт после первого отправленного файла */
  start(files: File[], autoApply: boolean) {
    if (state.running) return;
    raw = files;
    set({
      batchId: null,
      running: true,
      files: files.map((f, i) => ({ key: `${i}:${f.name}:${f.size}`, name: f.name, size: f.size, phase: 'queued', uploaded: 0 })),
    });
    void run(autoApply);
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useBatchUpload() {
  return useSyncExternalStore(batchUpload.subscribe, () => state);
}
