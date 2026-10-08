import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/query';

export interface SetupStep {
  key: string;
  title: string;
  description: string;
  done: boolean;
  optional: boolean;
  status: string;
  link: string;
  action: string;
}

export interface SetupStatus {
  steps: SetupStep[];
  completed: number;
  total: number;
  next: string | null;
}

/** Состояние мастера настройки (только для администратора и диспетчера) */
export function useSetupStatus() {
  const { canEdit } = useAuth();
  return useApi<SetupStatus>(['setup-status'], canEdit ? '/setup/status' : null, undefined, { staleTime: 15_000 });
}

/** Ссылка шага с признаком «пришли из мастера» — на странице показывается подсказка */
export function guideLink(link: string): string {
  return `${link}${link.includes('?') ? '&' : '?'}guide=1`;
}
