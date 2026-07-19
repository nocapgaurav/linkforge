import { ArrowRight, Link2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/common/ThemeToggle';

export default function LandingPage() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center justify-end px-4 lg:px-6">
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4">
        <section className="flex max-w-xl flex-col items-center gap-6 pb-24 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl border bg-foreground text-background">
            <Link2 className="size-6" aria-hidden="true" />
          </span>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">LinkForge</h1>
          <p className="text-balance text-muted-foreground">
            Shorten, manage, and measure your links. Production-grade redirects with
            first-class analytics.
          </p>
          <Button render={<Link href="/dashboard" />} nativeButton={false} size="lg">
            Go to Dashboard
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </section>
      </main>
    </div>
  );
}
