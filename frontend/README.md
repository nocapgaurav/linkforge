# LinkForge Frontend

Next.js dashboard for the LinkForge URL platform. The backend lives at the
repository root; this app consumes its REST API
(`docs/api-v1-spec.md` is the contract).

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui ·
Lucide · TanStack Query · React Hook Form + Zod · Sonner · next-themes

## Setup

```bash
# from the repository root
pnpm install

# start the backend + databases (in another terminal)
docker compose up -d --wait && pnpm dev        # backend on :3000

# start the frontend
cd frontend
cp .env.example .env.local                     # already correct for local dev
pnpm dev                                       # frontend on :3001
```

Open http://localhost:3001.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | yes | Base URL of the backend API, e.g. `http://localhost:3000/api/v1`. Inlined at build time (public). |

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Dev server with Turbopack on port 3001 |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build on port 3001 |
| `pnpm lint` | ESLint |

## Structure

```
src/
  app/               # routes: / (landing), /dashboard, /settings, not-found
  components/
    layout/          # dashboard shell: Sidebar, Navbar, MobileNav, DashboardLayout
    common/          # Logo, PageHeader, ThemeToggle
    ui/              # shadcn/ui primitives (generated; edit via shadcn CLI)
  lib/
    api/client.ts    # typed fetch wrapper around the API envelope
    providers/       # QueryProvider (TanStack Query), ThemeProvider (next-themes)
    utils.ts         # cn() class-name helper
  hooks/             # feature hooks land here (useLinks, useAnalytics, …)
  styles/globals.css # Tailwind v4 theme tokens (neutral palette)
  types/             # wire types (API envelope)
```

## Link management architecture

Data flows through three layers, one concern each:

```
components/links/*  ── UI, toasts, focus, inline errors
        │  use
hooks/useLinks · useCreateLink · useDeleteLink   ── server state (TanStack Query)
        │  call
lib/api/links.ts  ── typed request functions
        │  via
lib/api/client.ts ── envelope unwrapping + ApiError
```

**React Query hooks** — `useLinks` is an `useInfiniteQuery` over
`GET /api/v1/urls`: each page's `pagination.nextCursor` (treated as an
opaque string, never parsed) becomes the next page param; `hasMore: false`
maps to "no next page". All loaded pages stay mounted; "Load more" appends.
`useCreateLink` / `useDeleteLink` are mutations that invalidate the shared
`['links']` key on success, so every loaded page refetches and the list is
always consistent with the server.

**API flow (create)**: form (RHF + Zod, mirroring backend rules) →
`useCreateLink` → `createLink()` → `api.post('/urls')` → envelope unwrapped
→ on success: list invalidated, form reset, URL field refocused, toast; on
failure: `ALIAS_TAKEN` and per-field `VALIDATION_ERROR` details map to
inline field errors, network failures explain themselves, everything else
toasts.

**Errors**: query failures render a friendly alert with retry (network
unreachability called out explicitly); mutation failures follow the
inline-when-field-shaped, toast-otherwise rule above.

## Dashboard & analytics architecture

**Component hierarchy**

```
/dashboard                          /dashboard/links/[shortCode]?range=30d
  DashboardHeader (CTA→form focus)    AnalyticsView (owns range + query)
  DashboardStats ─ SummaryCard ×4       AnalyticsOverview ─ SummaryCard ×4
  CreateLinkForm                        ClickTimeline (Recharts line)
  SearchPlaceholder (visual only)       CountryChart ─┐ BreakdownBar
  LinkTable ─ LinkRow / LinkCard        BrowserChart ─┘ (shared, one hue)
                                        DeviceChart (donut, ≤4 slots + fold)
                                        ReferrerList (ranked list)
                                        AnalyticsSkeleton / Empty / Error
```

`SummaryCard`, `ChartCard` (fade-in + tooltip shell), and `BreakdownBar` are
the shared primitives — no duplicated card/chart markup anywhere.

**Metrics strategy** — dashboard stats are computed locally from the pages
the list query already holds (zero extra requests); when more pages exist
the values show a `+` and say so. *Today's Clicks* renders `—` with
"Available after dashboard aggregate endpoint." because the backend has no
global aggregate yet — nothing is fabricated. Analytics numbers come from
the backend verbatim.

**React Query strategy & caching** — `['links']` (infinite, opaque cursor)
is shared by the table and the stats row: one request feeds both, and
create/delete invalidate one key. Analytics caches per
`['analytics', shortCode, range]`, so range flips are instant once visited;
the range preset lives in the URL (`?range=7d|30d|90d|365d`), making views
shareable and back/forward correct. Presets map to backend intervals
(7d/30d→day, 90d→week, 365d→month) to keep chart point counts readable.

**Charts** — Recharts on a CVD-validated palette exposed as `--chart-1..5`
tokens (light and dark values, validated against both surfaces).
Single-measure charts use one hue; the donut caps at 4 validated slots and
folds the tail into "Other"; every chart has an `aria-label`, a labeled
legend or direct labels, and a polished tooltip. Skeletons mirror final
layouts; charts fade in over 200ms.

## Conventions

- **API access** goes through `lib/api/client.ts` only — it unwraps the
  backend's `{success, data|error}` envelope and throws a typed `ApiError`
  (with `status`, `code`, per-field `details`). Feature hooks build on it
  with TanStack Query; components never call `fetch`.
- **Design language**: neutral palette, generous whitespace, subtle borders,
  minimal shadows, no gradients. Follow the existing components.
- **Theming**: class-based dark mode via next-themes (light/dark/system);
  style with token utilities (`bg-background`, `text-muted-foreground`, …)
  so both themes work automatically.
- **Accessibility**: semantic landmarks, `aria-label` on icon-only buttons,
  `aria-current` on active nav links, visible focus rings.

## CORS

The backend allowlists one browser origin via its `FRONTEND_ORIGIN` env
var (already set to `http://localhost:3001` for local dev). If you change
this app's port or host, update `FRONTEND_ORIGIN` in the backend `.env`
to match.
