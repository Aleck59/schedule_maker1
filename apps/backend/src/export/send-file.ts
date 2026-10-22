import type { Response } from 'express';

/** Имя файла без запрещённых символов и не длиннее 120 знаков (кириллица — 2 байта, лимит ОС — 255 байт) */
export function safeFilename(filename: string, max = 120): string {
  const safe = filename
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (safe.length <= max) return safe;
  const dot = safe.lastIndexOf('.');
  const ext = dot > 0 && safe.length - dot <= 6 ? safe.slice(dot) : '';
  return `${safe.slice(0, max - ext.length - 1).trimEnd()}…${ext}`;
}

/** Отправка файла с корректным именем на кириллице */
export function sendFile(res: Response, buffer: Buffer, filename: string, contentType: string) {
  const safe = safeFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7E]+/g, '_');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
  );
  res.send(buffer);
}
