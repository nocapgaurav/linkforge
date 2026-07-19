import { MobileNav } from '@/components/layout/MobileNav';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { Logo } from '@/components/common/Logo';

/** Top bar: mobile nav + logo on small screens, actions on the right. */
export function Navbar() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 lg:px-6">
      <MobileNav />
      <div className="lg:hidden">
        <Logo />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
      </div>
    </header>
  );
}
