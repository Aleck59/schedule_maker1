import { lazy, Suspense, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppLayout } from '@/components/layout/app-layout';
import { LoadingState } from '@/components/common/states';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider, useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/query';
import type { UserRole } from '@/lib/types';
import LoginPage from '@/pages/LoginPage';

const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const SchedulePage = lazy(() => import('@/pages/SchedulePage'));
const GenerationPage = lazy(() => import('@/pages/GenerationPage'));
const HourControlPage = lazy(() => import('@/pages/HourControlPage'));
const ProgramsPage = lazy(() => import('@/pages/ProgramsPage'));
const ProgramDetailsPage = lazy(() => import('@/pages/ProgramDetailsPage'));
const CalendarGraphPage = lazy(() => import('@/pages/CalendarGraphPage'));
const WorkloadPage = lazy(() => import('@/pages/WorkloadPage'));
const GroupsPage = lazy(() => import('@/pages/GroupsPage'));
const GroupDetailsPage = lazy(() => import('@/pages/GroupDetailsPage'));
const TeachersPage = lazy(() => import('@/pages/TeachersPage'));
const TeacherDetailsPage = lazy(() => import('@/pages/TeacherDetailsPage'));
const ClassroomsPage = lazy(() => import('@/pages/ClassroomsPage'));
const ClassroomDetailsPage = lazy(() => import('@/pages/ClassroomDetailsPage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const MySchedulePage = lazy(() => import('@/pages/MySchedulePage'));
const MakeupPage = lazy(() => import('@/pages/MakeupPage'));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const UsersPage = lazy(() => import('@/pages/UsersPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

const STAFF: UserRole[] = ['ADMIN', 'DISPATCHER', 'MANAGER'];
const EDITORS: UserRole[] = ['ADMIN', 'DISPATCHER'];

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="mx-auto mt-24 max-w-md p-6">
        <LoadingState rows={3} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) {
    return (
      <div className="text-muted-foreground mt-10 text-center">
        <div className="text-lg font-medium">Недостаточно прав</div>
        <div className="text-sm">Раздел недоступен для вашей роли</div>
      </div>
    );
  }
  return <>{children}</>;
}

const page = (el: ReactNode, roles?: UserRole[]) => (
  <Suspense fallback={<LoadingState rows={6} />}>{roles ? <RequireRole roles={roles}>{el}</RequireRole> : el}</Suspense>
);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                element={
                  <RequireAuth>
                    <AppLayout />
                  </RequireAuth>
                }
              >
                <Route index element={page(<DashboardPage />)} />
                <Route path="my" element={page(<MySchedulePage />, ['TEACHER', 'STUDENT'])} />
                <Route path="schedule" element={page(<SchedulePage />, [...STAFF, 'TEACHER'])} />
                <Route path="generation" element={page(<GenerationPage />, EDITORS)} />
                <Route path="hour-control" element={page(<HourControlPage />, STAFF)} />
                <Route path="makeup" element={page(<MakeupPage />, [...EDITORS, 'TEACHER'])} />
                <Route path="programs" element={page(<ProgramsPage />, STAFF)} />
                <Route path="programs/:id" element={page(<ProgramDetailsPage />, STAFF)} />
                <Route path="calendar" element={page(<CalendarGraphPage />, STAFF)} />
                <Route path="workload" element={page(<WorkloadPage />, STAFF)} />
                <Route path="groups" element={page(<GroupsPage />, STAFF)} />
                <Route path="groups/:id" element={page(<GroupDetailsPage />, STAFF)} />
                <Route path="teachers" element={page(<TeachersPage />, STAFF)} />
                <Route path="teachers/:id" element={page(<TeacherDetailsPage />, STAFF)} />
                <Route path="classrooms" element={page(<ClassroomsPage />, STAFF)} />
                <Route path="classrooms/:id" element={page(<ClassroomDetailsPage />, STAFF)} />
                <Route path="reports" element={page(<ReportsPage />, [...STAFF, 'TEACHER'])} />
                <Route path="notifications" element={page(<NotificationsPage />)} />
                <Route path="settings" element={page(<SettingsPage />, EDITORS)} />
                <Route path="users" element={page(<UsersPage />, ['ADMIN'])} />
                <Route path="*" element={page(<NotFoundPage />)} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
      <Toaster richColors position="top-right" closeButton />
    </QueryClientProvider>
  );
}
