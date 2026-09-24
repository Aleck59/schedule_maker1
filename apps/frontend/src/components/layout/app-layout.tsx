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

const STAFF: UserRole[] = ['ADMIN', 'DISPATCHER', 'MANAGER'];
const EDITORS: UserRole[] = ['ADMIN', 'DISPATCHER'];

const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: 'Расписание',
    items: [
      { to: '/', label: 'Главная', icon: LayoutDashboard, roles: ['ADMIN', 'DISPATCHER', 'MANAGER', 'TEACHER', 'STUDENT'] },
      { to: '/my', label: 'Моё расписание', icon: CalendarCheck2, roles: ['TEACHER', 'STUDENT'] },
      { to: '/schedule', label: 'Расписание', icon: CalendarDays, roles: [...STAFF, 'TEACHER'] },
      { to: '/generation', label: 'Автосоставление', icon: Sparkles, roles: EDITORS },
      { to: '/hour-control', label: 'Выполнение часов', icon: ClipboardCheck, roles: STAFF },
      { to: '/makeup', label: 'Отработки', icon: RotateCcw, roles: [...EDITORS, 'TEACHER'] },
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
    section: 'Аналитика',
    items: [{ to: '/reports', label: 'Отчёты', icon: BarChart3, roles: [...STAFF, 'TEACHER'] }],
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
  return (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="bg-primary flex size-9 items-center justify-center rounded-lg text-white">
          <CalendarDays className="size-5" />
        </div>
        <div>
          <div className="text-sm leading-tight font-semibold text-white">Расписание СПО</div>
          <div className="text-sidebar-muted text-xs leading-tight">{user?.organization?.shortName ?? 'Колледж'}</div>
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 scrollbar-thin">
        {NAV.map((group) => {
          const items = group.items.filter((i) => user && i.roles.includes(user.role));
          if (items.length === 0) return null;
          return (
            <div key={group.section}>
              <div className="text-sidebar-muted px-2 pb-1.5 text-[11px] font-semibold tracking-wider uppercase">{group.section}</div>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'text-sidebar-foreground hover:bg-sidebar-accent flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                        isActive && 'bg-sidebar-accent font-medium text-white',
                      )
                    }
                  >
                    <item.icon className="size-4 opacity-80" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </div>
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
            <span className="bg-destructive absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
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
            <div key={n.id} className={cn('border-b px-4 py-2.5 text-sm last:border-0', !n.isRead && 'bg-primary/5')}>
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

  return (
    <div className="flex min-h-screen">
      <aside className="bg-sidebar fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="bg-sidebar absolute inset-y-0 left-0 w-64">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-2 text-white hover:bg-white/10"
              onClick={() => setMobileOpen(false)}
            >
              <X />
            </Button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="bg-card/80 sticky top-0 z-20 flex h-14 items-center gap-2 border-b px-4 backdrop-blur">
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
                  <div className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-full text-xs font-semibold">
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
          <Outlet />
        </main>
      </div>
    </div>
  );
}
