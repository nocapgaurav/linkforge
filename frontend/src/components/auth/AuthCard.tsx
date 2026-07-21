import { Logo } from '@/components/common/Logo';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Shared shell for /login and /register: centered card, logo, title, the
 * form (children), and a footer slot for the "switch to the other page"
 * link. Factored out because both pages are otherwise identical wrappers
 * around different forms — same reasoning as ChartCard for the analytics
 * panels.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  /** Omit for pages with no "switch to the other page" link (e.g. /unlock, /link). */
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center justify-between px-4 lg:px-6">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-24">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <Card>
            <CardContent className="pt-6">{children}</CardContent>
          </Card>
          {footer && <p className="text-center text-sm text-muted-foreground">{footer}</p>}
        </div>
      </main>
    </div>
  );
}
