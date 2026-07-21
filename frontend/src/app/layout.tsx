import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { QueryProvider } from '@/lib/providers/QueryProvider';
import { ThemeProvider } from '@/lib/providers/ThemeProvider';
import '@/styles/globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'LinkForge',
    template: '%s — LinkForge',
  },
  description: 'Shorten, manage, and measure your links.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: next-themes mutates <html> class pre-paint.
    // Font variables live on <html> because the shadcn base layer applies
    // font-sans there; on <body> they'd be invisible to it (serif fallback).
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>
              {children}
              <Toaster position="top-right" richColors />
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
