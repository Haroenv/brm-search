import { readFile, writeFile } from 'fs/promises';

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

// Country bounding boxes (approximate) - supports multiple boxes per country
type BoundingBox = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};
const countryBounds: Record<string, BoundingBox[]> = {
  India: [{ minLat: 6, maxLat: 37, minLng: 68, maxLng: 97 }],
  USA: [
    { minLat: 24, maxLat: 49, minLng: -125, maxLng: -66 }, // Continental US
    { minLat: 51, maxLat: 71.5, minLng: -180, maxLng: -129 }, // Alaska
    { minLat: 18.9, maxLat: 22.3, minLng: -160, maxLng: -154.7 }, // Hawaii
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

const expectedKeys = [
  'name',
  'date',
  'dateNumber',
  'distance',
  'country',
  'region',
  'department',
  'city',
  '_geoloc',
  'map',
  'site',
  'mail',
  'club',
  'ascent',
  'time',
  'status',
  'meta',
  'objectID',
];

async function analyzeBrevets() {
  console.log('Reading brevets.json...');
  const data = await readFile(
    '/Users/haroen.viaene/Developer/haroenv/brm-search/brevets.json',
    'utf-8'
  );
  const brevets: Brevet[] = JSON.parse(data);

  console.log(`Total brevets: ${brevets.length}`);

  const anomalies: Anomaly[] = [];
  const stats = {
    missingGeoloc: 0,
    invalidGeoloc: 0,
    geolocOutOfBounds: 0,
    unexpectedKeys: 0,
    invalidDistance: 0,
    invalidDate: 0,
    multipleGeolocations: 0,
  };

  for (const brevet of brevets) {
    const issues: string[] = [];

    // Check for unexpected keys
    const brevetKeys = Object.keys(brevet);
    const unexpectedKeysList = brevetKeys.filter(
      (k) => !expectedKeys.includes(k)
    );
    if (unexpectedKeysList.length > 0) {
      issues.push(`Unexpected keys: ${unexpectedKeysList.join(', ')}`);
      stats.unexpectedKeys++;
    }

    // Check _geoloc
    if (!brevet._geoloc || !Array.isArray(brevet._geoloc)) {
      issues.push('Missing or invalid _geoloc array');
      stats.missingGeoloc++;
    } else {
      if (brevet._geoloc.length === 0) {
        issues.push('Empty _geoloc array');
        stats.missingGeoloc++;
      } else if (brevet._geoloc.length > 1) {
        issues.push(`Multiple geolocations (${brevet._geoloc.length})`);
        stats.multipleGeolocations++;
      }

      // Check each geolocation
      for (let i = 0; i < brevet._geoloc.length; i++) {
        const geo = brevet._geoloc[i];

        if (typeof geo.lat !== 'number' || typeof geo.lng !== 'number') {
          issues.push(`Invalid geoloc[${i}]: lat or lng not a number`);
          stats.invalidGeoloc++;
        } else if (isNaN(geo.lat) || isNaN(geo.lng)) {
          issues.push(`Invalid geoloc[${i}]: lat or lng is NaN`);
          stats.invalidGeoloc++;
        } else if (
          geo.lat < -90 ||
          geo.lat > 90 ||
          geo.lng < -180 ||
          geo.lng > 180
        ) {
          issues.push(
            `Invalid geoloc[${i}]: out of world bounds (lat=${geo.lat}, lng=${geo.lng})`
          );
          stats.invalidGeoloc++;
        } else {
          // Check if coordinates match the country
          const boundsList = countryBounds[brevet.country];
          if (boundsList) {
            const inBounds = boundsList.some(
              (bounds) =>
                geo.lat >= bounds.minLat &&
                geo.lat <= bounds.maxLat &&
                geo.lng >= bounds.minLng &&
                geo.lng <= bounds.maxLng
            );
            if (!inBounds) {
              issues.push(
                `Geoloc (${geo.lat}, ${geo.lng}) outside ${brevet.country} bounds`
              );
              stats.geolocOutOfBounds++;
            }
          }
        }
      }
    }

    // Check distance
    if (brevet.distance < 0) {
      issues.push(`Invalid distance: ${brevet.distance}`);
      stats.invalidDistance++;
    }

    // Check dateNumber format
    if (brevet.dateNumber && brevet.dateNumber.toString().length !== 8) {
      issues.push(`Invalid dateNumber format: ${brevet.dateNumber}`);
      stats.invalidDate++;
    }

    if (issues.length > 0) {
      anomalies.push({
        objectID: brevet.objectID,
        country: brevet.country,
        issues,
        data: {
          date: brevet.date,
          distance: brevet.distance,
          region: brevet.region,
          city: brevet.city,
          _geoloc: brevet._geoloc,
          site: brevet.site,
        },
      });
    }
  }

  console.log('\n=== STATISTICS ===');
  console.log(
    `Total anomalies found: ${anomalies.length} (${((anomalies.length / brevets.length) * 100).toFixed(2)}%)`
  );
  console.log(`Missing/invalid geoloc: ${stats.missingGeoloc}`);
  console.log(`Invalid geoloc coordinates: ${stats.invalidGeoloc}`);
  console.log(`Geoloc out of country bounds: ${stats.geolocOutOfBounds}`);
  console.log(`Multiple geolocations: ${stats.multipleGeolocations}`);
  console.log(`Unexpected keys: ${stats.unexpectedKeys}`);
  console.log(`Invalid distance: ${stats.invalidDistance}`);
  console.log(`Invalid date: ${stats.invalidDate}`);

  // Save anomalies to file
  await writeFile(
    '/Users/haroen.viaene/Developer/haroenv/brm-search/anomalies.json',
    JSON.stringify(anomalies, null, 2)
  );

  console.log(`\nAnomalies saved to anomalies.json`);

  // Print some examples
  console.log('\n=== SAMPLE ANOMALIES ===');
  anomalies.slice(0, 10).forEach((a) => {
    console.log(`\n${a.objectID} (${a.country})`);
    a.issues.forEach((issue) => console.log(`  - ${issue}`));
  });
}

analyzeBrevets().catch(console.error);
