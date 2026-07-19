import { Link2 } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Wordmark used in the sidebar, mobile nav, and landing hero. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="LinkForge home"
      className={cn(
        'flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <span className="flex size-7 items-center justify-center rounded-md border bg-foreground text-background">
        <Link2 className="size-4" aria-hidden="true" />
      </span>
      <span className="text-sm font-semibold tracking-tight">LinkForge</span>
    </Link>
  );
}
