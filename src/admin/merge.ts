import type { Brevet } from '../types';
import { distanceBucket, normalize, normalizeCountry } from './normalize';

/**
 * Strict match key: same calendar date, same distance bucket, same country, same city.
 * Two records sharing this key are very likely the same real event.
 */
export function eventKey(b: Brevet): string {
  return [
    b.date,
    distanceBucket(b.distance),
    normalizeCountry(b.country),
    normalize(b.city),
  ].join('|');
}

/**
 * Relaxed key: drops the city. Used only as a fallback for sparse records
 * (no city info). Even then, the safety gate must confirm before merging.
 */
export function relaxedEventKey(b: Brevet): string {
  return [
    b.date,
    distanceBucket(b.distance),
    normalizeCountry(b.country),
  ].join('|');
}

/**
 * How "rich" is a record? Used to break ties when picking the merge winner.
 * Source-agnostic: it's about the data, not where it came from.
 */
export function dataQualityScore(b: Brevet): number {
  let score = 0;
  if (b.name && b.name.trim()) score++;
  if (b.club && b.club.trim()) score++;
  if (b.city && b.city.trim()) score++;
  if (b.region && b.region.trim()) score++;
  if (b.department && b.department.trim()) score++;
  if (b.mail && b.mail.trim()) score++;
  if (b.site && b.site.trim()) score++;
  if (b.status && b.status.trim()) score++;
  if (b.ascent && b.ascent > 0) score++;
  if (b._geoloc?.[0]?.lat && b._geoloc?.[0]?.lng) score++;
  if (b.map && b.map.length > 0) score += b.map.length;
  return score;
}

/**
 * Deterministic winner: most data, then has geoloc, then objectID lex.
 */
export function pickWinner(cluster: Brevet[]): Brevet {
  if (cluster.length === 1) return cluster[0];
  return [...cluster].sort((a, b) => {
    const sa = dataQualityScore(a);
    const sb = dataQualityScore(b);
    if (sa !== sb) return sb - sa;
    const ga = a._geoloc?.[0]?.lat ? 1 : 0;
    const gb = b._geoloc?.[0]?.lat ? 1 : 0;
    if (ga !== gb) return gb - ga;
    return a.objectID.localeCompare(b.objectID);
  })[0];
}

const isEmptyStr = (v: unknown) => !v || (typeof v === 'string' && !v.trim());
const isEmptyNum = (v: unknown) => v === undefined || v === null || v === 0;
const isEmptyArr = (v: unknown) => !Array.isArray(v) || v.length === 0;

/**
 * Per-field merge strategy. The default for any new schema field is `firstNonEmpty`,
 * which means adding a field requires no code change here — but if you want a
 * smarter rule (longest string, max number, union of arrays) add it explicitly.
 */
type Strategy =
  | { type: 'firstNonEmpty' }    // winner's value, else first non-empty other
  | { type: 'longestString' }    // longest non-empty string across cluster
  | { type: 'maxNumber' }        // max of positive values
  | { type: 'unionArray' }       // dedup union of array values
  | { type: 'firstGeoloc' }      // first non-empty _geoloc
  | { type: 'keepWinner' };      // identity — winner's value, never override

const STRATEGIES: Record<keyof Brevet, Strategy> = {
  objectID: { type: 'keepWinner' },
  date: { type: 'keepWinner' },
  dateNumber: { type: 'keepWinner' },
  distance: { type: 'keepWinner' },
  country: { type: 'keepWinner' },
  meta: { type: 'keepWinner' },

  name: { type: 'longestString' },
  displayTitle: { type: 'longestString' },
  club: { type: 'longestString' },
  city: { type: 'firstNonEmpty' },
  region: { type: 'firstNonEmpty' },
  department: { type: 'firstNonEmpty' },
  mail: { type: 'firstNonEmpty' },
  site: { type: 'firstNonEmpty' },
  status: { type: 'firstNonEmpty' },
  time: { type: 'firstNonEmpty' },

  ascent: { type: 'maxNumber' },
  map: { type: 'unionArray' },
  _geoloc: { type: 'firstGeoloc' },
};

function applyStrategy<K extends keyof Brevet>(
  key: K,
  winner: Brevet,
  others: Brevet[],
  strategy: Strategy,
): Brevet[K] {
  const all = [winner, ...others];
  switch (strategy.type) {
    case 'keepWinner':
      return winner[key];

    case 'firstNonEmpty': {
      for (const r of all) {
        if (!isEmptyStr(r[key])) return r[key];
      }
      return winner[key];
    }

    case 'longestString': {
      let best = winner[key] as unknown as string | undefined;
      let bestLen = best && typeof best === 'string' ? best.trim().length : 0;
      for (const r of others) {
        const v = r[key] as unknown as string | undefined;
        if (v && typeof v === 'string' && v.trim().length > bestLen) {
          best = v;
          bestLen = v.trim().length;
        }
      }
      return best as Brevet[K];
    }

    case 'maxNumber': {
      let best = isEmptyNum(winner[key]) ? undefined : (winner[key] as unknown as number);
      for (const r of others) {
        const v = r[key] as unknown as number | undefined;
        if (!isEmptyNum(v) && (best === undefined || (v as number) > best)) {
          best = v;
        }
      }
      return best as Brevet[K];
    }

    case 'unionArray': {
      const out = new Set<unknown>();
      for (const r of all) {
        const v = r[key] as unknown;
        if (Array.isArray(v)) for (const item of v) out.add(item);
      }
      const arr = [...out];
      return (arr.length > 0 ? arr : undefined) as Brevet[K];
    }

    case 'firstGeoloc': {
      for (const r of all) {
        const g = (r as any)._geoloc?.[0];
        if (g?.lat && g?.lng) return (r as any)._geoloc;
      }
      return winner[key];
    }
  }
}

/**
 * Merge a cluster of records into one. Winner is picked by data quality;
 * fields are then merged according to STRATEGIES.
 */
export function mergeCluster(cluster: Brevet[]): Brevet {
  if (cluster.length === 1) return cluster[0];
  const winner = pickWinner(cluster);
  const others = cluster.filter((r) => r !== winner);
  const merged: Brevet = { ...winner };

  const seen = new Set<string>();
  for (const r of cluster) {
    for (const k of Object.keys(r)) {
      if (seen.has(k)) continue;
      seen.add(k);
      const strategy = STRATEGIES[k as keyof Brevet] ?? { type: 'firstNonEmpty' };
      (merged as any)[k] = applyStrategy(k as keyof Brevet, winner, others, strategy);
    }
  }

  return merged;
}

/**
 * Is the cluster safe to merge?
 *
 * Rule: members must already share the event-identifying dimensions (date, distance,
 * country) — they're clustered by `eventKey`, so this is implicit. On top of that,
 * either:
 *   - all members share a non-empty normalized city (strong match), OR
 *   - all cities empty AND members share a non-empty club, mail, or site (weak match)
 *
 * Otherwise members are different events that happen to share key dimensions; keep them
 * apart even if it means visible duplicates.
 *
 * Returns `{ safe, reason }` so the caller can log why a merge was/wasn't done.
 */
export function isSafeToMerge(cluster: Brevet[]): { safe: boolean; reason: string } {
  if (cluster.length <= 1) return { safe: true, reason: 'single' };

  const cities = new Set(cluster.map((b) => normalize(b.city)).filter(Boolean));
  if (cities.size > 1) {
    return { safe: false, reason: `${cities.size} distinct cities` };
  }
  if (cities.size === 1) {
    return { safe: true, reason: 'shared city' };
  }

  // All cities empty: need a strong shared identifier. `site` is intentionally
  // excluded because it's often a federation/umbrella domain (e.g.
  // randonneurs.bc.ca) shared across unrelated events.
  const clubs = new Set(cluster.map((b) => normalize(b.club)).filter(Boolean));
  if (clubs.size === 1) return { safe: true, reason: 'empty city, shared club' };

  const mails = new Set(cluster.map((b) => normalize(b.mail)).filter(Boolean));
  if (mails.size === 1) return { safe: true, reason: 'empty city, shared mail' };

  return { safe: false, reason: 'empty city, no shared identifier' };
}

export type MergeReport = {
  records: Brevet[];
  clusters: Array<{
    key: string;
    winner: Brevet;
    losers: Brevet[];
    reason: string;
  }>;
  ambiguous: Array<{
    key: string;
    members: Brevet[];
    reason: string;
  }>;
};

/**
 * Cluster records by `eventKey`, then for each cluster either merge (safe) or keep
 * separate (ambiguous). No records are dropped: each input record either survives as
 * the winner of its cluster or as a separate unmerged record.
 */
export function mergeRecords(records: Brevet[]): MergeReport {
  const clusters = new Map<string, Brevet[]>();
  for (const r of records) {
    const key = eventKey(r);
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(r);
  }

  const out: Brevet[] = [];
  const merged: MergeReport['clusters'] = [];
  const ambiguous: MergeReport['ambiguous'] = [];

  for (const [key, cluster] of clusters) {
    if (cluster.length === 1) {
      out.push(cluster[0]);
      continue;
    }
    const safety = isSafeToMerge(cluster);
    if (safety.safe) {
      const winner = pickWinner(cluster);
      const losers = cluster.filter((r) => r !== winner);
      const mergedRecord = mergeCluster(cluster);
      out.push(mergedRecord);
      merged.push({ key, winner: mergedRecord, losers, reason: safety.reason });
    } else {
      out.push(...cluster);
      ambiguous.push({ key, members: cluster, reason: safety.reason });
    }
  }

  return { records: out, clusters: merged, ambiguous };
}
