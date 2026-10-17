import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const COLORS = [
  'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200',
  'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200',
];

export function initialsOf(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function colorOf(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

/** Фотография преподавателя (загружается с авторизацией) или инициалы, если фото нет */
export function TeacherPhoto({
  teacher,
  className,
}: {
  teacher: { id: string; fullName: string; photoUpdatedAt: string | null };
  className?: string;
}) {
  const photo = useQuery({
    queryKey: ['teacher-photo', teacher.id, teacher.photoUpdatedAt],
    queryFn: ({ signal }) => api.get<Blob>(`/teachers/${teacher.id}/photo`, undefined, { raw: true, signal }),
    enabled: !!teacher.photoUpdatedAt,
    staleTime: Infinity,
  });
  const url = useMemo(() => (photo.data ? URL.createObjectURL(photo.data) : null), [photo.data]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return (
    <div
      className={cn(
        'flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full text-base font-semibold select-none',
        !url && colorOf(teacher.fullName),
        className,
      )}
      aria-hidden
    >
      {url ? <img src={url} alt="" className="size-full object-cover" /> : initialsOf(teacher.fullName)}
    </div>
  );
}
