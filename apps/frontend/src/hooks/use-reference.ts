import { useApi } from '@/lib/query';
import type { Classroom, Group, Program, SchedulePeriod, Semester, SettingsResponse, Teacher } from '@/lib/types';

/** Справочные данные, используемые на многих страницах */
export const useSettings = () => useApi<SettingsResponse>(['settings'], '/settings', undefined, { staleTime: 5 * 60_000 });
export const useGroups = (enabled = true) => useApi<Group[]>(['groups'], '/groups', undefined, { enabled });
export const useTeachers = (enabled = true) => useApi<Teacher[]>(['teachers'], '/teachers', undefined, { enabled });
export const useClassrooms = (enabled = true) => useApi<Classroom[]>(['classrooms'], '/classrooms', undefined, { enabled });
export const usePrograms = (enabled = true) => useApi<Program[]>(['programs'], '/programs', undefined, { enabled });
export const useSemesters = (enabled = true) => useApi<Semester[]>(['semesters'], '/semesters', undefined, { enabled });
export const usePeriods = () => useApi<SchedulePeriod[]>(['schedule-periods'], '/schedule-periods');
