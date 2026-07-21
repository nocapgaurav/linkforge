import { defineConfig } from 'vitest/config';

/**
 * The backend previously ran on vitest's defaults (no config file needed).
 * Now that frontend/ has its own separate vitest suite (its own config,
 * jsx/alias setup, jsdom environment), the backend's default test glob —
 * which has no reason to know about a sibling app — picks up those files
 * too when `pnpm test` runs from the repo root, and fails to parse them
 * (no JSX support, no `@/*` alias here). Exclude frontend/ explicitly so
 * each side's `pnpm test` only ever runs its own suite.
 */
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', 'frontend/**'],
  },
});
