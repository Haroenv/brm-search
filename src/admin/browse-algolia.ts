import algoliasearch from 'algoliasearch';
import type { Brevet } from '../types';

const { ALGOLIA_APP = '', ALGOLIA_WRITE = '' } = process.env;

if (!ALGOLIA_APP) {
  throw new Error('Missing ALGOLIA_APP env variable');
}
if (!ALGOLIA_WRITE) {
  throw new Error('Missing ALGOLIA_WRITE env variable');
}

const client = algoliasearch(ALGOLIA_APP, ALGOLIA_WRITE);
const index = client.initIndex('brevets');

console.log('Browsing Algolia index...');

const brevets: Brevet[] = [];

await index.browseObjects({
  query: '',
  batch: (batch) => {
    brevets.push(...(batch as Brevet[]));
    console.log(`Fetched ${brevets.length} brevets so far...`);
  },
});

console.log(`Total brevets fetched: ${brevets.length}`);

const tmpFile = `brevets.json`;
await Bun.write(tmpFile, JSON.stringify(brevets, null, 2));

console.log(`Saved to ${tmpFile}`);
