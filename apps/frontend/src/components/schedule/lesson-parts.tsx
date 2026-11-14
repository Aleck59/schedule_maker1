import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Строка «подпись — значение» в окне пары или экзамена */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Ссылка на исходник (группа, дисциплина, преподаватель, аудитория). Без доступа — обычный текст. */
export function RefLink({ to, children }: { to: string | null; children: ReactNode }) {
  if (!to) return <>{children}</>;
  return (
    <Link
      to={to}
      className="text-blue-600 underline-offset-2 hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
    >
      {children}
    </Link>
  );
}

export function lessonOptions(count: number) {
  return Array.from({ length: count }, (_, i) => ({ value: String(i + 1), label: `${i + 1} пара` }));
}
