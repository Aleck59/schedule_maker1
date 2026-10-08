import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 text-center">
      <div className="text-5xl font-semibold">404</div>
      <div className="text-muted-foreground">Страница не найдена</div>
      <Button asChild>
        <Link to="/">На главную</Link>
      </Button>
    </div>
  );
}
