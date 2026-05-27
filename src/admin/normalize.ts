/**
 * Aggressive normalization for matching: lowercase, strip diacritics,
 * collapse non-alphanumeric runs to a single space, trim.
 * Use for match keys, not display.
 */
export function normalize(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const COUNTRY_ALIASES: Record<string, string> = {
  holland: 'netherlands',
  'the netherlands': 'netherlands',
  nl: 'netherlands',
  uk: 'united kingdom',
  'great britain': 'united kingdom',
  gb: 'united kingdom',
  usa: 'united states',
  'u s a': 'united states',
  us: 'united states',
};

export function normalizeCountry(value: unknown): string {
  const n = normalize(value);
  return COUNTRY_ALIASES[n] || n;
}

export function distanceBucket(distance: number | undefined): number | undefined {
  if (distance === undefined || distance === null || !isFinite(distance)) return undefined;
  return Math.floor(distance / 100) * 100;
}

/**
 * Sniff the originating source from the shape of `meta`. Used for
 * debugging, telemetry, and source-aware merge rules.
 */
export function sourceOf(brevet: { objectID?: string; meta?: any }): string {
  const m = brevet.meta || {};
  if ((brevet.objectID || '').startsWith('supabase__')) return 'map';
  if ((brevet.objectID || '').startsWith('belgium__')) return 'belgium';
  if ((brevet.objectID || '').startsWith('auk__')) return 'auk';
  if ((brevet.objectID || '').startsWith('nl__')) return 'netherlands';
  if ('RoadMap' in m && 'Pays' in m) return 'acp';
  if ('NominalDistance' in m || 'AAAPoints' in m) return 'auk';
  if ('global_id_lineage' in m) return 'belgium';
  if ('contact' in m && 'from' in m && 'start' in m) return 'netherlands';
  if ('location' in m && 'type' in m) return 'usa';
  if ('Date' in m && 'Event Name' in m && 'E-Mail' in m) return 'ireland';
  if ('DATA' in m && 'DISTANZA' in m) return 'italy';
  if ('Country' in m && 'Start Location' in m && 'Event Name' in m) return 'lrm';
  return 'unknown';
}
