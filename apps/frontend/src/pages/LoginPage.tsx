import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarDays, ClipboardCheck, LogIn, Sparkles, Users } from 'lucide-react';
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

const FEATURES = [
  { icon: Sparkles, title: 'Автосоставление', text: 'Расписание всех групп одной кнопкой, без накладок' },
  { icon: ClipboardCheck, title: 'Контроль часов', text: 'План, расписание и факт по каждой дисциплине' },
  { icon: Users, title: 'Для всех ролей', text: 'Диспетчер, преподаватель, студент и руководитель' },
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
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="page-enter grid w-full max-w-5xl items-center gap-10 md:grid-cols-[1.15fr_1fr]">
        <div className="hidden flex-col md:flex">
          <div className="brand-gradient mb-6 flex size-12 items-center justify-center rounded-2xl text-white shadow-[0_10px_30px_-10px_oklch(0.5_0.22_272/0.8)]">
            <CalendarDays className="size-6" />
          </div>
          <h1 className="text-4xl leading-tight font-semibold tracking-tight">
            Расписание <span className="text-gradient">СПО и ВО</span>
          </h1>
          <p className="text-muted-foreground mt-3 max-w-md text-[15px]">
            Учебные планы, нагрузка, календарный график и составление расписания с оптимизацией в одном месте.
          </p>
          <div className="stagger mt-8 grid gap-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-card/70 flex items-center gap-3 rounded-2xl border border-border/70 p-3 shadow-soft backdrop-blur">
                <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
                  <f.icon className="size-5" />
                </div>
                <div>
                  <div className="text-sm font-medium">{f.title}</div>
                  <div className="text-muted-foreground text-xs">{f.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <Card className="bg-card/85 shadow-lift backdrop-blur-xl">
          <CardHeader>
            <div className="brand-gradient mb-2 flex size-10 items-center justify-center rounded-xl text-white md:hidden">
              <CalendarDays className="size-5" />
            </div>
            <CardTitle className="text-xl tracking-tight">Вход в систему</CardTitle>
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
              <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
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
                    className="hover:bg-accent flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors"
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
