import { Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Visual-only search affordance; functionality ships in a later sprint. */
export function SearchPlaceholder() {
  return (
    <div className="relative max-w-md">
      <Label htmlFor="link-search" className="sr-only">
        Search links (coming soon)
      </Label>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id="link-search"
        type="search"
        placeholder="Search links..."
        disabled
        className="pl-9 pr-28"
      />
      <Badge
        variant="secondary"
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
      >
        Coming Soon
      </Badge>
    </div>
  );
}
