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

const key = (b) =>
  [b.dateNumber || '', b.distance ?? '', norm(b.country), norm(b.city)].join(
    '|'
  );

const groups = new Map();
for (const b of data) {
  if (!norm(b.city)) continue;
  const k = key(b);
  const arr = groups.get(k) || [];
  arr.push(b);
  groups.set(k, arr);
}

const pairCounts = new Map();
for (const arr of groups.values()) {
  const sources = [...new Set(arr.map(sourceOf))].sort();
  if (sources.length < 2) continue;
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const pair = `${sources[i]}+${sources[j]}`;
      pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
    }
  }
}

const mapInternalLikelyDups = [...groups.values()]
  .map((arr) => ({
    arr,
    mapRows: arr.filter((x) => sourceOf(x) === 'map'),
    nonMapRows: arr.filter((x) => sourceOf(x) !== 'map'),
  }))
  .filter((g) => g.mapRows.length > 1 && g.nonMapRows.length > 0).length;

console.log(
  JSON.stringify(
    {
      sourcePairCounts: Object.fromEntries(
        [...pairCounts.entries()].sort((a, b) => b[1] - a[1])
      ),
      groupsWithMapMultiRowsAndOtherSource: mapInternalLikelyDups,
    },
    null,
    2
  )
);
