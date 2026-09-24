import { useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

/** Подтверждение опасного действия */
export function Confirm({
  trigger,
  title,
  description,
  confirmText = 'Подтвердить',
  destructive,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  confirmText?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? 'bg-destructive hover:bg-destructive/90' : undefined}
            onClick={() => {
              void onConfirm();
            }}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
