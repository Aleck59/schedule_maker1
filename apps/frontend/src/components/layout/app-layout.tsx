import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  CalendarCheck2,
  CalendarDays,
  CalendarRange,
  Compass,
  ClipboardCheck,
  FileSpreadsheet,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  RotateCcw,
  Settings,
  Sparkles,
  Sun,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { GuideBar } from '@/components/setup/guide-bar';
import { useSetupStatus } from '@/components/setup/use-setup';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { ROLE_LABELS } from '@/lib/labels';
import { useApi, useApiMutation } from '@/lib/query';
import type { Notification, UserRole } from '@/lib/types';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: UserRole[];
}

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev';

const STAFF: UserRole[] = ['ADMIN', 'DISPATCHER', 'MANAGER'];
const EDITORS: UserRole[] = ['ADMIN', 'DISPATCHER'];

const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: 'Работа',
    items: [
      { to: '/setup', label: 'Мастер настройки', icon: Compass, roles: EDITORS },
      { to: '/', label: 'Главная', icon: LayoutDashboard, roles: ['ADMIN', 'DISPATCHER', 'MANAGER', 'TEACHER', 'STUDENT'] },
      { to: '/my', label: 'Моё расписание', icon: CalendarCheck2, roles: ['TEACHER', 'STUDENT'] },
      { to: '/schedule', label: 'Расписание', icon: CalendarDays, roles: [...STAFF, 'TEACHER'] },
      { to: '/generation', label: 'Составление', icon: Sparkles, roles: EDITORS },
      { to: '/hour-control', label: 'Выполнение часов', icon: ClipboardCheck, roles: STAFF },
      { to: '/makeup', label: 'Отработки', icon: RotateCcw, roles: [...EDITORS, 'TEACHER'] },
      { to: '/reports', label: 'Отчёты', icon: BarChart3, roles: [...STAFF, 'TEACHER'] },
    ],
  },
  {
    section: 'Планирование',
    items: [
      { to: '/programs', label: 'Учебные планы', icon: BookOpen, roles: STAFF },
      { to: '/calendar', label: 'Календарный график', icon: CalendarRange, roles: STAFF },
      { to: '/workload', label: 'Нагрузка', icon: FileSpreadsheet, roles: STAFF },
    ],
  },
  {
    section: 'Справочники',
    items: [
      { to: '/groups', label: 'Группы', icon: GraduationCap, roles: STAFF },
      { to: '/teachers', label: 'Преподаватели', icon: Users, roles: STAFF },
      { to: '/classrooms', label: 'Аудитории', icon: Building2, roles: STAFF },
    ],
  },
  {
    section: 'Администрирование',
    items: [
      { to: '/users', label: 'Пользователи', icon: UserCog, roles: ['ADMIN'] },
      { to: '/settings', label: 'Настройки', icon: Settings, roles: ['ADMIN', 'DISPATCHER'] },
    ],
  },
];

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('sm.theme') === 'dark';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('sm.theme', dark ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const setup = useSetupStatus();
  // Мастер настройки — наверху, пока есть незавершённые шаги; когда всё готово, он уходит в «Администрирование»
  const setupDone = !!setup.data && !setup.data.next;
  const sections = NAV.map((group) => {
    let items = group.items.filter((i) => user && i.roles.includes(user.role));
    if (setupDone) items = items.filter((i) => i.to !== '/setup');
    if (setupDone && group.section === 'Администрирование') {
      const wizard = NAV[0].items.find((i) => i.to === '/setup')!;
      if (user && wizard.roles.includes(user.role)) items = [...items, wizard];
    }
    return { ...group, items };
  });
  const org = user?.organization?.shortName ?? 'Колледж';
  return (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <div className="brand-gradient flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-[0_6px_16px_-6px_oklch(0.5_0.22_272/0.7)]">
          <CalendarDays className="size-[18px]" />
        </div>
        <div className="min-w-0">
          <div className="text-foreground text-[15px] leading-tight font-semibold tracking-tight">Расписание</div>
          <div className="text-sidebar-muted truncate text-xs leading-tight" title={org}>
            {org}
          </div>
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 scrollbar-thin">
        {sections.map((group) => {
          if (group.items.length === 0) return null;
          return (
            <div key={group.section}>
              <div className="text-sidebar-muted px-2.5 pb-1.5 text-[11px] font-semibold tracking-wider uppercase">{group.section}</div>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'nav-item text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-sm transition-colors duration-200',
                        isActive && 'active bg-sidebar-accent text-sidebar-active font-medium',
                      )
                    }
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {item.to === '/setup' && setup.data?.next && (
                      <span className="ml-auto rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700 tabular-nums dark:bg-amber-400/15 dark:text-amber-200">
                        {setup.data.completed}/{setup.data.total}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-sidebar-muted border-t border-border/60 px-5 py-3 text-[11px]">Версия {APP_VERSION}</div>
    </nav>
  );
}

function NotificationsBell() {
  const navigate = useNavigate();
  const unread = useApi<{ count: number }>(['notifications', 'unread'], '/notifications/unread-count', undefined, {
    refetchInterval: 60_000,
  });
  const list = useApi<Notification[]>(['notifications', 'list'], '/notifications');
  const readAll = useApiMutation(() => api.post('/notifications/read-all'), { invalidate: [['notifications']] });
  const count = unread.data?.count ?? 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Уведомления">
          <Bell />
          {count > 0 && (
            <span className="animate-pop bg-destructive ring-background absolute top-1 right-1 flex min-w-4 ring-2 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="text-sm font-semibold">Уведомления</div>
          {count > 0 && (
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => readAll.mutate(undefined)}>
              Прочитать все
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {(list.data ?? []).slice(0, 8).map((n) => (
            <div key={n.id} className={cn('hover:bg-muted/50 border-b px-4 py-2.5 text-sm transition-colors last:border-0', !n.isRead && 'bg-primary/5')}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{n.title}</span>
                <span className="text-muted-foreground shrink-0 text-[11px]">{formatDateTime(n.createdAt)}</span>
              </div>
              <div className="text-muted-foreground mt-0.5 text-xs">{n.message}</div>
            </div>
          ))}
          {list.data?.length === 0 && <div className="text-muted-foreground px-4 py-6 text-center text-sm">Уведомлений нет</div>}
        </div>
        <div className="border-t p-2">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => navigate('/notifications')}>
            Все уведомления
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { dark, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  return (
    <div className="flex min-h-screen">
      <aside className="bg-sidebar fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border/70 backdrop-blur-xl lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="animate-fade-in absolute inset-0 bg-slate-950/30 backdrop-blur-[3px]" onClick={() => setMobileOpen(false)} />
          <aside className="animate-drawer bg-card shadow-lift absolute inset-y-0 left-0 w-72 max-w-[85vw]">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-2"
              onClick={() => setMobileOpen(false)}
              aria-label="Закрыть меню"
            >
              <X />
            </Button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="bg-background/70 sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border/60 px-4 backdrop-blur-xl md:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Меню">
            <Menu />
          </Button>
          <div className="text-muted-foreground hidden text-sm md:block">{user?.organization?.name}</div>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Тема оформления">
              {dark ? <Sun /> : <Moon />}
            </Button>
            <NotificationsBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2">
                  <div className="brand-gradient flex size-8 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm">
                    {user?.fullName
                      .split(' ')
                      .slice(0, 2)
                      .map((p) => p[0])
                      .join('')}
                  </div>
                  <div className="hidden text-left sm:block">
                    <div className="text-sm leading-tight font-medium">{user?.fullName}</div>
                    <div className="text-muted-foreground text-[11px] leading-tight">{user && ROLE_LABELS[user.role]}</div>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="text-sm">{user?.fullName}</div>
                  <div className="text-muted-foreground text-xs font-normal">{user?.email}</div>
                  <Badge variant="secondary" className="mt-1.5">
                    {user && ROLE_LABELS[user.role]}
                  </Badge>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/notifications')}>
                  <Bell /> Уведомления
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={async () => {
                    await logout();
                    navigate('/login');
                  }}
                >
                  <LogOut /> Выйти
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] flex-1 space-y-5 p-4 md:p-6">
          <GuideBar />
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
