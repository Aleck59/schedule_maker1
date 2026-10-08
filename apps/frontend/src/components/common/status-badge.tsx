import { Badge } from '@/components/ui/badge';
import {
  HOUR_STATUS_LABELS,
  HOUR_STATUS_VARIANT,
  JOB_STATUS_LABELS,
  LESSON_STATUS_LABELS,
  LESSON_STATUS_VARIANT,
  PERIOD_STATUS_LABELS,
  PERIOD_STATUS_VARIANT,
} from '@/lib/labels';

export function LessonStatusBadge({ status }: { status: string }) {
  return <Badge variant={LESSON_STATUS_VARIANT[status] ?? 'secondary'}>{LESSON_STATUS_LABELS[status] ?? status}</Badge>;
}

export function PeriodStatusBadge({ status }: { status: string }) {
  return <Badge variant={PERIOD_STATUS_VARIANT[status] ?? 'secondary'}>{PERIOD_STATUS_LABELS[status] ?? status}</Badge>;
}

export function HourStatusBadge({ status }: { status: string }) {
  return <Badge variant={HOUR_STATUS_VARIANT[status] ?? 'secondary'}>{HOUR_STATUS_LABELS[status] ?? status}</Badge>;
}

const JOB_VARIANT: Record<string, 'info' | 'success' | 'warning' | 'destructive' | 'muted' | 'violet'> = {
  QUEUED: 'muted',
  GENERATING: 'info',
  VALIDATING: 'info',
  COMPLETED: 'success',
  COMPLETED_WITH_CONFLICTS: 'warning',
  FAILED: 'destructive',
  APPLIED: 'violet',
  CANCELLED: 'muted',
};

export function JobStatusBadge({ status }: { status: string }) {
  return <Badge variant={JOB_VARIANT[status] ?? 'secondary'}>{JOB_STATUS_LABELS[status] ?? status}</Badge>;
}
