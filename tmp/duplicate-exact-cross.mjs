import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('brevets.json', 'utf8'));

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

const byObjectID = new Map();
for (const b of data) {
  const arr = byObjectID.get(b.objectID) || [];
  arr.push(b);
  byObjectID.set(b.objectID, arr);
}

const exactCross = [...byObjectID.entries()]
  .map(([objectID, arr]) => ({
    objectID,
    arr,
    sources: [...new Set(arr.map(sourceOf))].sort(),
  }))
  .filter((g) => g.arr.length > 1 && g.sources.length > 1)
  .sort((a, b) => b.arr.length - a.arr.length)
  .slice(0, 25)
  .map((g) => ({
    objectID: g.objectID,
    count: g.arr.length,
    sources: g.sources,
    sample: g.arr.slice(0, 4).map((b) => ({
      src: sourceOf(b),
      date: b.date,
      country: b.country,
      city: b.city,
      distance: b.distance,
      name: b.name,
      club: b.club,
    })),
  }));

console.log(JSON.stringify(exactCross, null, 2));
