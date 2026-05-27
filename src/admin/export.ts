import algoliasearch from 'algoliasearch';
import { addGeoloc } from './geocode';
import * as acp from './export-acp';
import * as map from './export-map';
import * as lrm from './export-lrm';
import * as usa from './export-usa';
import * as auk from './export-auk';
import * as ireland from './export-ireland';
import * as italy from './export-italy';
import * as belgium from './export-belgium';
import * as netherlands from './export-netherlands';
import { Brevet } from '../types';
import { getDisplayTitle } from '../display-title';
import { buildClubRegistry, enrichBrevets } from './enrich-clubs';
import { eventKey, mergeRecords } from './merge';
import { stableHash } from './id-utils';

const {
  ALGOLIA_APP = '',
  ALGOLIA_WRITE = '',
  SKIP_INDEX = '',
} = process.env;
if (!ALGOLIA_APP && !SKIP_INDEX) {
  throw new Error('Missing ALGOLIA_APP env variable');
}
if (!ALGOLIA_WRITE && !SKIP_INDEX) {
  throw new Error('Missing ALGOLIA_WRITE env variable');
}

const errors: Array<{ source: string; error: unknown }> = [];

const sources = [
  { name: 'acp', pkg: acp },
  { name: 'map', pkg: map },
  { name: 'lrm', pkg: lrm },
  { name: 'usa', pkg: usa },
  { name: 'auk', pkg: auk },
  { name: 'ireland', pkg: ireland },
  { name: 'italy', pkg: italy },
  { name: 'belgium', pkg: belgium },
  { name: 'netherlands', pkg: netherlands },
];

async function fetchAllData() {
  const results = await Promise.all(
    sources.map(async ({ name, pkg }) => {
      try {
        return await pkg.getData();
      } catch (error) {
        console.error(`Error fetching data from ${name}:`, error);
        errors.push({ source: name, error });
        return [];
      }
    })
  );
  return results.flat();
}

type Geoloc = { lat: number; lng: number };

async function getExistingData() {
  const existingObjectIDs = new Set<string>();
  const existingGeoById = new Map<string, Geoloc>();
  const existingGeoByEventKey = new Map<string, Geoloc>();

  if (SKIP_INDEX) {
    console.warn('SKIP_INDEX is set, skipping fetching existing data from Algolia');
    return { existingObjectIDs, existingGeoById, existingGeoByEventKey };
  }

  const client = algoliasearch(ALGOLIA_APP, ALGOLIA_WRITE);
  await client.initIndex('brevets').browseObjects<Brevet>({
    attributesToRetrieve: ['objectID', '_geoloc', 'date', 'distance', 'country', 'city'],
    batch: (objects) => {
      objects.forEach((object) => {
        existingObjectIDs.add(object.objectID);
        const geoLoc = (object as any)._geoloc?.[0];
        if (geoLoc?.lat && geoLoc?.lng) {
          existingGeoById.set(object.objectID, geoLoc);
          existingGeoByEventKey.set(eventKey(object), geoLoc);
        }
      });
    },
  });

  return { existingObjectIDs, existingGeoById, existingGeoByEventKey };
}

/**
 * Reuse the geoloc we already have for this real-world event. Look up by
 * `eventKey` first (survives ID changes), then fall back to `objectID` for
 * records that happen to have stable IDs already.
 */
function inheritGeoloc(
  brevet: Brevet,
  existingGeoById: Map<string, Geoloc>,
  existingGeoByEventKey: Map<string, Geoloc>,
) {
  if (brevet._geoloc?.[0]) return brevet;
  const geo = existingGeoByEventKey.get(eventKey(brevet)) || existingGeoById.get(brevet.objectID);
  return geo ? { ...brevet, _geoloc: [geo] } : brevet;
}

const ROUTE_HOSTS = new Set([
  'ridewithgps.com',
  'www.ridewithgps.com',
  'openrunner.com',
  'www.openrunner.com',
  'strava.com',
  'www.strava.com',
  'connect.garmin.com',
  'garmin.com',
  'www.garmin.com',
  'plotaroute.com',
  'www.plotaroute.com',
  'komoot.com',
  'www.komoot.com',
  'alltrails.com',
  'www.alltrails.com',
  'mapmagic.app',
  'nakarte.me',
  'brmtool.kantaro.org',
  'rusa.org',
]);

function normalizeUrl(url: string) {
  return url
    .trim()
    .replace(/&amp;|&#0*38;|&#38;/gi, '&')
    .replace(/[).,;]+$/, '');
}

function isDirectRouteFile(url: string) {
  return /\.(gpx|kml|tcx|geojson|json)(\?|#|$)/i.test(url);
}

function isLikelyRouteUrl(url: string) {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return false;
  }

  if (isDirectRouteFile(url)) {
    return true;
  }

  try {
    const parsed = new URL(url);
    if (!ROUTE_HOSTS.has(parsed.hostname)) {
      return false;
    }

    const path = parsed.pathname;

    if (parsed.hostname.includes('ridewithgps.com')) {
      return (
        /^\/routes\/\d+(?:\.gpx)?$/i.test(path) ||
        /^\/collections\/\d+$/i.test(path) ||
        (path === '/embeds' &&
          (parsed.searchParams.get('type') === 'route' ||
            parsed.searchParams.get('type') === 'collection'))
      );
    }

    if (parsed.hostname.includes('openrunner.com')) {
      return (
        /^\/r\/\d+$/i.test(path) ||
        /^\/(?:[a-z]{2}\/)?route-details\/\d+$/i.test(path)
      );
    }

    if (parsed.hostname.includes('strava.com')) {
      return /^\/routes\/\d+$/i.test(path);
    }

    if (parsed.hostname.includes('plotaroute.com')) {
      return /^\/route\/\d+$/i.test(path);
    }

    if (parsed.hostname.includes('komoot.com')) {
      return /^\/(?:tour|collection)\/\d+$/i.test(path);
    }

    if (parsed.hostname.includes('alltrails.com')) {
      return /\/trail\//i.test(path) || /\/explore\/map\//i.test(path);
    }

    if (parsed.hostname === 'rusa.org') {
      return (
        /\/routesearch_PF\.pl$/i.test(path) &&
        /^\d+$/.test(parsed.searchParams.get('rtid') || '')
      );
    }

    return true;
  } catch {
    return false;
  }
}

function collectRouteUrlsFromValue(value: unknown, urls: Set<string>) {
  if (!value) {
    return;
  }

  if (typeof value === 'string') {
    const matches = value.match(/https?:\/\/[^\s'"<>]+/g) || [];
    for (const match of matches) {
      const normalized = normalizeUrl(match);
      if (isLikelyRouteUrl(normalized)) {
        urls.add(normalized);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const nested of value) {
      collectRouteUrlsFromValue(nested, urls);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const nested of Object.values(value)) {
      collectRouteUrlsFromValue(nested, urls);
    }
  }
}

function enrichMapLinks(brevet: Brevet) {
  const urls = new Set<string>();

  for (const mapUrl of brevet.map || []) {
    const normalized = normalizeUrl(mapUrl);
    if (isLikelyRouteUrl(normalized)) {
      urls.add(normalized);
    }
  }

  collectRouteUrlsFromValue(brevet.meta, urls);

  const orderedMapUrls = [...urls].sort((a, b) => a.localeCompare(b));

  return {
    ...brevet,
    map: orderedMapUrls,
  };
}

/**
 * Final global collision-safety pass. After merging, two records that survive
 * as separate events may still share an `objectID` (different sources produced
 * the same derived ID). Append a salt hash so Algolia doesn't silently
 * overwrite one with the other.
 */
function deduplicateObjectIDs(records: Brevet[]): Brevet[] {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.objectID, (counts.get(r.objectID) || 0) + 1);
  if ([...counts.values()].every((c) => c === 1)) return records;

  const seen = new Map<string, number>();
  return records.map((r) => {
    if ((counts.get(r.objectID) || 0) === 1) return r;
    const salt = [
      r.club || '',
      r.mail || '',
      r.site || '',
      r.name || '',
      r.region || '',
      r.department || '',
    ].join('|');
    const suffix = stableHash(salt.toLowerCase());
    const candidate = `${r.objectID}__${suffix}`;
    const nthHere = (seen.get(candidate) || 0) + 1;
    seen.set(candidate, nthHere);
    return {
      ...r,
      objectID: nthHere === 1 ? candidate : `${candidate}_${nthHere}`,
    };
  });
}

const [data, clubRegistry] = await Promise.all([fetchAllData(), buildClubRegistry()]);
const withClubSites = enrichBrevets(data, clubRegistry);
const mergeReport = mergeRecords(withClubSites);
console.log(
  `Merged ${data.length} records → ${mergeReport.records.length} ` +
    `(merged ${mergeReport.clusters.length} clusters, kept ${mergeReport.ambiguous.length} ambiguous clusters separate)`
);

// Hard assertions: every input record's identity is represented in the output.
const inputCount = withClubSites.length;
const losersCount = mergeReport.clusters.reduce((a, c) => a + c.losers.length, 0);
const outputCount = mergeReport.records.length;
if (inputCount !== outputCount + losersCount) {
  throw new Error(
    `Merge accounting mismatch: input=${inputCount}, output=${outputCount}, losers=${losersCount}`,
  );
}

const deduplicatedIDs = deduplicateObjectIDs(mergeReport.records);
const uniqueIDs = new Set(deduplicatedIDs.map((r) => r.objectID));
if (uniqueIDs.size !== deduplicatedIDs.length) {
  throw new Error(
    `objectID collision after global dedupe: ${deduplicatedIDs.length - uniqueIDs.size} duplicates remain`,
  );
}

const enriched = deduplicatedIDs.map(enrichMapLinks);

const { existingObjectIDs, existingGeoById, existingGeoByEventKey } = await getExistingData();

const newBrevets = enriched.filter((b) => !existingObjectIDs.has(b.objectID));
const existingBrevets = enriched
  .filter((b) => existingObjectIDs.has(b.objectID))
  .map((b) => inheritGeoloc(b, existingGeoById, existingGeoByEventKey));

const needsGeocoding = [
  ...newBrevets.map((b) => inheritGeoloc(b, existingGeoById, existingGeoByEventKey)),
  ...existingBrevets.filter((b) => !b._geoloc?.[0]),
];
const geocoded = await addGeoloc(needsGeocoding);

const allBrevets = [
  ...geocoded,
  ...existingBrevets.filter((b) => b._geoloc?.[0]),
].map((brevet) => ({
  ...brevet,
  displayTitle: getDisplayTitle(brevet),
}));

await Bun.write('brevets.json', JSON.stringify(allBrevets, null, 2));
console.log(`Exported ${allBrevets.length} brevets`);

if (errors.length > 0) {
  console.error('\n❌ Errors occurred during data export:');
  errors.forEach(({ source, error }) => {
    console.error(`  - ${source}: ${error instanceof Error ? error.message : String(error)}`);
  });
  process.exit(1);
}
