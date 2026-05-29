import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('brevets.json', 'utf8'));

const norm = (s) =>
  (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function sourceOf(b) {
  if ((b.objectID || '').startsWith('supabase__')) return 'map';
  const m = b.meta || {};
  if ('RoadMap' in m && 'Pays' in m) return 'acp';
  if ('NominalDistance' in m || 'AAAPoints' in m) return 'auk';
  if ('global_id_lineage' in m) return 'belgium';
  if ('contact' in m && 'from' in m && 'start' in m) return 'netherlands';
  if ('location' in m && 'type' in m) return 'usa';
  if ('Date' in m && 'Event Name' in m && 'E-Mail' in m) return 'ireland';
  if ('DATA' in m && 'DISTANZA' in m) return 'italy';
  if ('Country' in m && 'Start Location' in m && 'Event Name' in m)
    return 'lrm';
  return 'unknown';
}

function strictKey(b) {
  return [
    b.dateNumber || '',
    b.distance ?? '',
    norm(b.country),
    norm(b.city),
  ].join('|');
}

function relaxedKey(b) {
  const city = norm(b.city || b.department || b.region || '');
  return [b.dateNumber || '', b.category || '', norm(b.country), city].join(
    '|'
  );
}

function groupBy(keyFn, opts = { requireNonEmptyCity: false }) {
  const groups = new Map();
  for (const b of data) {
    const city = norm(b.city);
    if (opts.requireNonEmptyCity && !city) continue;
    const k = keyFn(b);
    const arr = groups.get(k) || [];
    arr.push(b);
    groups.set(k, arr);
  }
  return [...groups.entries()].map(([key, arr]) => {
    const sources = [...new Set(arr.map(sourceOf))].sort();
    return { key, arr, sources };
  });
}

const sourceCounts = Object.fromEntries(
  Object.entries(
    data.reduce((acc, b) => {
      const s = sourceOf(b);
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1])
);

const exactObjectIdGroups = groupBy((b) => b.objectID).filter(
  (g) => g.arr.length > 1
);

const exactCrossSource = exactObjectIdGroups.filter(
  (g) => g.sources.length > 1
);

const strictCrossSourceNonEmptyCity = groupBy(strictKey, {
  requireNonEmptyCity: true,
}).filter((g) => g.arr.length > 1 && g.sources.length > 1);

const relaxedCrossSource = groupBy(relaxedKey, {
  requireNonEmptyCity: false,
}).filter((g) => g.arr.length > 1 && g.sources.length > 1);

const topStrict = strictCrossSourceNonEmptyCity
  .sort((a, b) => b.arr.length - a.arr.length)
  .slice(0, 20)
  .map((g) => ({
    key: g.key,
    count: g.arr.length,
    sources: g.sources,
    sample: g.arr.slice(0, 5).map((b) => ({
      src: sourceOf(b),
      objectID: b.objectID,
      date: b.date,
      country: b.country,
      city: b.city,
      distance: b.distance,
      category: b.category,
      name: b.name,
      club: b.club,
    })),
  }));

const summary = {
  total: data.length,
  sourceCounts,
  exactObjectIdDupGroups: exactObjectIdGroups.length,
  exactObjectIdDupRows: exactObjectIdGroups.reduce(
    (n, g) => n + g.arr.length,
    0
  ),
  exactCrossSourceGroups: exactCrossSource.length,
  exactCrossSourceRows: exactCrossSource.reduce((n, g) => n + g.arr.length, 0),
  strictCrossSourceNonEmptyCityGroups: strictCrossSourceNonEmptyCity.length,
  strictCrossSourceNonEmptyCityRows: strictCrossSourceNonEmptyCity.reduce(
    (n, g) => n + g.arr.length,
    0
  ),
  relaxedCrossSourceGroups: relaxedCrossSource.length,
  relaxedCrossSourceRows: relaxedCrossSource.reduce(
    (n, g) => n + g.arr.length,
    0
  ),
};

console.log(JSON.stringify({ summary, topStrict }, null, 2));
