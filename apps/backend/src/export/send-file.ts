import type { Response } from 'express';

/** Отправка файла с корректным именем на кириллице */
export function sendFile(res: Response, buffer: Buffer, filename: string, contentType: string) {
  const safe = filename.replace(/[\\/:*?"<>|]+/g, '_');
  const ascii = safe.replace(/[^\x20-\x7E]+/g, '_');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
  );
  res.send(buffer);
}
