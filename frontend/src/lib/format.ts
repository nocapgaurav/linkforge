/** Shared display formatters so every surface renders numbers/dates alike. */

export const formatNumber = (value: number): string =>
  new Intl.NumberFormat('en-US').format(value);

export const formatCompactNumber = (value: number): string =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

/** '2026-07-19' (UTC bucket date) → 'Jul 19' without timezone drift. */
export function formatBucketDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** ISO country code → display name; unknown codes fall through unchanged. */
export function formatCountry(code: string): string {
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** 'chrome' → 'Chrome'; leaves multi-word labels alone. */
export function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
