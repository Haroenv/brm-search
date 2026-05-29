import { readFile, writeFile } from 'fs/promises';
import PlaceKit from '@placekit/client-js';

const { PLACEKIT = '' } = process.env;
if (!PLACEKIT) {
  throw new Error('Missing PLACEKIT env variable');
}

const pk = PlaceKit(PLACEKIT);

interface Brevet {
  date: string;
  dateNumber: number;
  distance: number;
  country: string;
  region: string;
  department: string;
  city: string;
  _geoloc: Array<{ lat: number; lng: number }>;
  map: any[];
  site: string;
  mail: string;
  club: string;
  ascent: number;
  time: number;
  status: string;
  meta: any;
  objectID: string;
  [key: string]: any;
}

interface Anomaly {
  objectID: string;
  country: string;
  issues: string[];
  data: any;
}

// Country bounding boxes for validation
type BoundingBox = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

const countryBounds: Record<string, BoundingBox[]> = {
  India: [{ minLat: 6, maxLat: 37, minLng: 68, maxLng: 97 }],
  USA: [
    { minLat: 24, maxLat: 49, minLng: -125, maxLng: -66 },
    { minLat: 51, maxLat: 71.5, minLng: -180, maxLng: -129 },
    { minLat: 18.9, maxLat: 22.3, minLng: -160, maxLng: -154.7 },
  ],
  Belgium: [{ minLat: 49.5, maxLat: 51.5, minLng: 2.5, maxLng: 6.5 }],
  Netherlands: [{ minLat: 50.7, maxLat: 53.6, minLng: 3.3, maxLng: 7.2 }],
  France: [{ minLat: 41, maxLat: 51.5, minLng: -5, maxLng: 10 }],
  'United Kingdom': [{ minLat: 49.9, maxLat: 61, minLng: -8, maxLng: 2 }],
  Germany: [{ minLat: 47, maxLat: 55, minLng: 5.8, maxLng: 15.1 }],
  Italy: [{ minLat: 35.5, maxLat: 47.1, minLng: 6.6, maxLng: 18.5 }],
  Spain: [{ minLat: 36, maxLat: 43.8, minLng: -9.3, maxLng: 4.3 }],
  Portugal: [{ minLat: 36.9, maxLat: 42.2, minLng: -9.5, maxLng: -6.2 }],
  Australia: [{ minLat: -44, maxLat: -10, minLng: 113, maxLng: 154 }],
  Japan: [{ minLat: 24, maxLat: 46, minLng: 123, maxLng: 146 }],
  Canada: [{ minLat: 41.7, maxLat: 83.1, minLng: -141, maxLng: -52.6 }],
  Ireland: [{ minLat: 51.4, maxLat: 55.4, minLng: -10.5, maxLng: -5.5 }],
  Turkiye: [{ minLat: 36, maxLat: 42, minLng: 26, maxLng: 45 }],
  Turkey: [{ minLat: 36, maxLat: 42, minLng: 26, maxLng: 45 }],
  Poland: [{ minLat: 49, maxLat: 55, minLng: 14, maxLng: 24.2 }],
  'Czech Republic': [{ minLat: 48.5, maxLat: 51, minLng: 12, maxLng: 18.9 }],
  Austria: [{ minLat: 46.4, maxLat: 49, minLng: 9.5, maxLng: 17.2 }],
  Switzerland: [{ minLat: 45.8, maxLat: 47.8, minLng: 5.9, maxLng: 10.5 }],
  Sweden: [{ minLat: 55.3, maxLat: 69.1, minLng: 11, maxLng: 24.2 }],
  Norway: [{ minLat: 57.9, maxLat: 71, minLng: 4.5, maxLng: 31.1 }],
  Denmark: [{ minLat: 54.5, maxLat: 57.8, minLng: 8, maxLng: 15.2 }],
  Brazil: [{ minLat: -34, maxLat: 5.3, minLng: -74, maxLng: -34.8 }],
  Argentina: [{ minLat: -55, maxLat: -21.8, minLng: -73.6, maxLng: -53.6 }],
  'South Africa': [{ minLat: -35, maxLat: -22, minLng: 16.5, maxLng: 33 }],
  'New Zealand': [{ minLat: -47, maxLat: -34, minLng: 166, maxLng: 179 }],
  Mexico: [{ minLat: 14.5, maxLat: 32.7, minLng: -118.4, maxLng: -86.7 }],
};

function isInCountryBounds(lat: number, lng: number, country: string): boolean {
  const boundsList = countryBounds[country];
  if (!boundsList) return true; // If we don't have bounds, assume it's ok

  return boundsList.some(
    (bounds) =>
      lat >= bounds.minLat &&
      lat <= bounds.maxLat &&
      lng >= bounds.minLng &&
      lng <= bounds.maxLng
  );
}

async function geocodeAddress(address: string): Promise<{
  lat: number;
  lng: number;
} | null> {
  try {
    const out = await pk.search(address, {
      maxResults: 1,
      types: ['city'],
    });

    const result = out.results[0];
    if (!result || !result.lat || !result.lng) {
      return null;
    }

    return {
      lat: result.lat,
      lng: result.lng,
    };
  } catch (error) {
    console.error(`  Geocoding error for "${address}":`, error);
    return null;
  }
}

function shouldAttemptRgeocode(anomaly: Anomaly): boolean {
  // Attempt re-geocode if:
  // 1. Empty _geoloc array
  // 2. Geoloc out of country bounds
  // 3. Invalid geoloc coordinates
  return anomaly.issues.some(
    (issue) =>
      issue.includes('Empty _geoloc') ||
      (issue.includes('outside') && issue.includes('bounds')) ||
      issue.includes('Invalid geoloc')
  );
}

async function fixAnomalies() {
  console.log('Reading anomalies.json...');
  const anomaliesData = await readFile(
    '/Users/haroen.viaene/Developer/haroenv/brm-search/anomalies.json',
    'utf-8'
  );
  const anomalies: Anomaly[] = JSON.parse(anomaliesData);

  console.log('Reading brevets.json...');
  const brevetsData = await readFile(
    '/Users/haroen.viaene/Developer/haroenv/brm-search/brevets.json',
    'utf-8'
  );
  const brevets: Brevet[] = JSON.parse(brevetsData);

  // Create a map for quick lookup
  const brevetsMap = new Map<string, Brevet>();
  brevets.forEach((b) => brevetsMap.set(b.objectID, b));

  const stats = {
    total: anomalies.length,
    attempted: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    stillOutOfBounds: 0,
  };

  console.log(`\nProcessing ${anomalies.length} anomalies...\n`);

  for (const anomaly of anomalies) {
    const brevet = brevetsMap.get(anomaly.objectID);
    if (!brevet) {
      console.log(`⚠️  Brevet not found: ${anomaly.objectID}`);
      stats.skipped++;
      continue;
    }

    if (!shouldAttemptRgeocode(anomaly)) {
      stats.skipped++;
      continue;
    }

    stats.attempted++;

    // Build address string
    const addressParts = [
      brevet.city,
      brevet.department,
      brevet.region,
      brevet.country,
    ].filter(Boolean);

    if (addressParts.length === 0) {
      console.log(
        `⏭️  Skipping ${anomaly.objectID}: No address information available`
      );
      stats.failed++;
      continue;
    }

    const address = addressParts.join(', ');
    console.log(
      `🔍 Attempting to geocode: ${anomaly.objectID}\n   Address: "${address}"`
    );

    // Try geocoding
    const location = await geocodeAddress(address);

    if (!location) {
      console.log(`   ❌ Failed to geocode`);
      stats.failed++;
      continue;
    }

    // Validate the new coordinates are in country bounds
    const inBounds = isInCountryBounds(
      location.lat,
      location.lng,
      brevet.country
    );

    if (!inBounds) {
      console.log(
        `   ⚠️  New coordinates (${location.lat}, ${location.lng}) still outside ${brevet.country} bounds`
      );
      stats.stillOutOfBounds++;
      stats.failed++;
      continue;
    }

    // Update the brevet
    brevet._geoloc = [location];
    console.log(
      `   ✅ Successfully geocoded to (${location.lat}, ${location.lng})`
    );
    stats.successful++;

    // Rate limiting - wait a bit between requests
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log('\n=== FIXING STATISTICS ===');
  console.log(`Total anomalies: ${stats.total}`);
  console.log(`Attempted to fix: ${stats.attempted}`);
  console.log(`Successfully fixed: ${stats.successful}`);
  console.log(`Failed to fix: ${stats.failed}`);
  console.log(`Skipped (not geocodable): ${stats.skipped}`);
  console.log(`Still out of bounds: ${stats.stillOutOfBounds}`);

  if (stats.successful > 0) {
    console.log('\nSaving updated brevets.json...');
    await writeFile(
      '/Users/haroen.viaene/Developer/haroenv/brm-search/brevets.json',
      JSON.stringify(brevets, null, 2)
    );
    console.log('✅ Done! Brevets have been updated.');
  } else {
    console.log('\n⚠️  No changes made to brevets.json');
  }
}

fixAnomalies().catch(console.error);
