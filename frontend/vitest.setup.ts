import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// RTL auto-cleans between tests under Jest via a global afterEach; vitest
// has no such global, so it must be registered explicitly, or every
// rendered tree from every prior test stays mounted and accumulates.
afterEach(() => {
  cleanup();
});

/**
 * Node 26 ships its own experimental global `localStorage` accessor, which
 * shadows jsdom's implementation in vitest's jsdom environment (jsdom sets
 * `window === globalThis`) and returns `undefined` without the
 * `--localstorage-file` flag. Node's descriptor is configurable, so replace
 * it here with a small deterministic in-memory Storage — avoids both the
 * experimental flag and real disk-backed persistence leaking between runs.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  writable: true,
  configurable: true,
});
