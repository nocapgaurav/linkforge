'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/** Shared copy action so every copy surface toasts identically. */
export async function copyShortUrl(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success('Short URL copied.');
    return true;
  } catch {
    toast.error('Unable to copy.');
    return false;
  }
}

/** Copies a short URL to the clipboard with toast + brief icon feedback. */
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => clearTimeout(resetTimer.current ?? undefined), []);

  async function copy() {
    if (await copyShortUrl(value)) {
      setCopied(true);
      clearTimeout(resetTimer.current ?? undefined);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={copy}
      aria-label={`Copy short URL ${value}`}
    >
      {copied ? (
        <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      ) : (
        <Copy className="size-4" aria-hidden="true" />
      )}
    </Button>
  );
}
