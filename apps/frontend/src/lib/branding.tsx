import { useEffect } from 'react';
import { CalendarDays } from 'lucide-react';
import { useApi } from '@/lib/query';
import { cn } from '@/lib/utils';

/** Название и логотип программы (настраиваются администратором в «Настройки → Организация») */
export interface Branding {
  appName: string;
  appLogo: string | null;
  organizationName: string | null;
}

export const DEFAULT_APP_NAME = 'Расписание СПО и ВО';
const CACHE_KEY = 'sm.branding';
const DEFAULT_FAVICON = '/favicon.svg';

function readCache(): Branding | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Branding) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(b: Branding) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(b));
  } catch {
    /* переполнение или запрет хранилища — не критично */
  }
}

/** Брендинг доступен без входа; последнее значение берётся из кэша браузера, чтобы не мелькало название по умолчанию */
export function useBranding(): Branding {
  const q = useApi<Branding>(['branding'], '/settings/branding', undefined, {
    staleTime: 10 * 60_000,
    initialData: readCache,
    initialDataUpdatedAt: 0,
  });
  useEffect(() => {
    if (q.data && q.isFetchedAfterMount) writeCache(q.data);
  }, [q.data, q.isFetchedAfterMount]);
  return q.data ?? { appName: DEFAULT_APP_NAME, appLogo: null, organizationName: null };
}

/** Заголовок вкладки и значок сайта по настройкам */
export function BrandingHead() {
  const { appName, appLogo } = useBranding();
  useEffect(() => {
    document.title = appName;
  }, [appName]);
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = appLogo ?? DEFAULT_FAVICON;
    link.type = appLogo ? (appLogo.slice(5, appLogo.indexOf(';')) || 'image/png') : 'image/svg+xml';
  }, [appLogo]);
  return null;
}

/** Логотип программы: загруженная картинка или стандартный значок на градиенте */
export function AppLogo({ className, iconClassName, logo }: { className?: string; iconClassName?: string; logo?: string | null }) {
  const branding = useBranding();
  const src = logo === undefined ? branding.appLogo : logo;
  if (src) {
    return (
      <div className={cn('flex shrink-0 items-center justify-center overflow-hidden', className)}>
        <img src={src} alt="Логотип" className="size-full object-contain" />
      </div>
    );
  }
  return (
    <div className={cn('brand-gradient flex shrink-0 items-center justify-center text-white', className)}>
      <CalendarDays className={iconClassName} />
    </div>
  );
}

/** «Расписание СПО и ВО» → ['Расписание', 'СПО и ВО']: вторая часть выделяется градиентом */
export function splitAppName(name: string): [string, string] {
  const i = name.indexOf(' ');
  return i > 0 ? [name.slice(0, i), name.slice(i + 1)] : ['', name];
}
