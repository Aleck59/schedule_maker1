import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarDays, LogIn } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Field } from '@/components/common/field';
import { Spinner } from '@/components/common/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const schema = z.object({
  email: z.string().min(1, 'Укажите email').email('Некорректный email'),
  password: z.string().min(1, 'Укажите пароль'),
});
type FormValues = z.infer<typeof schema>;

const DEMO = [
  { role: 'Диспетчер', email: 'dispatcher@college.ru', password: 'Dispatcher123!' },
  { role: 'Администратор', email: 'admin@college.ru', password: 'Admin123!' },
  { role: 'Преподаватель', email: 'teacher@college.ru', password: 'Teacher123!' },
  { role: 'Студент', email: 'student@college.ru', password: 'Student123!' },
  { role: 'Руководитель', email: 'director@college.ru', password: 'Director123!' },
];

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  if (user) return <Navigate to="/" replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values.email, values.password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 p-4">
      <div className="grid w-full max-w-4xl gap-6 md:grid-cols-[1.1fr_1fr]">
        <div className="hidden flex-col justify-center text-white md:flex">
          <div className="bg-primary mb-5 flex size-12 items-center justify-center rounded-xl">
            <CalendarDays className="size-7" />
          </div>
          <h1 className="text-3xl font-semibold">Расписание СПО</h1>
          <p className="mt-3 text-slate-300">
            Автоматизированное составление расписания колледжа: учебные планы, нагрузка, календарный график, генерация
            расписания с оптимизацией (OR-Tools CP-SAT), контроль выполнения часов и учёт проведённых занятий.
          </p>
        </div>
        <Card className="shadow-xl">
          <CardHeader>
            <CardTitle className="text-xl">Вход в систему</CardTitle>
            <CardDescription>Введите учётные данные вашей организации</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="grid gap-4" noValidate>
              <Field label="Email" error={form.formState.errors.email?.message}>
                <Input type="email" autoComplete="username" placeholder="name@college.ru" {...form.register('email')} />
              </Field>
              <Field label="Пароль" error={form.formState.errors.password?.message}>
                <Input type="password" autoComplete="current-password" {...form.register('password')} />
              </Field>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Spinner /> : <LogIn />} Войти
              </Button>
            </form>
            <div className="mt-6 border-t pt-4">
              <div className="text-muted-foreground mb-2 text-xs font-medium">Демонстрационные учётные записи</div>
              <div className="grid gap-1">
                {DEMO.map((d) => (
                  <button
                    key={d.email}
                    type="button"
                    className="hover:bg-accent flex items-center justify-between rounded-md px-2 py-1.5 text-left text-xs cursor-pointer"
                    onClick={() => {
                      form.setValue('email', d.email);
                      form.setValue('password', d.password);
                    }}
                  >
                    <span className="font-medium">{d.role}</span>
                    <span className="text-muted-foreground">{d.email}</span>
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
