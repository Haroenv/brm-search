/**
 * Browse the live Algolia index, cluster records by eventKey, run the same
 * source-agnostic merge logic used in the export pipeline, and emit reports.
 *
 * Outputs:
 *   index-backup-<date>.json       full snapshot of the index before any writes
 *   dedupe-enrich.json             winners with their merged data (the saveObjects payload)
 *   dedupe-delete-safe.json        losers from city-match clusters (high confidence)
 *   dedupe-delete-review.json      losers from sparse-row clusters (needs human review)
 *   dedupe-ambiguous.json          clusters the safety gate refused to merge
 *
 * Flags:
 *   --apply-enrich    push the merged winners via saveObjects (non-destructive, idempotent)
 *
 * Deletions are deliberately NOT done by this script. Review the delete-*.json
 * files, then run delete-objects.ts with whichever you've approved.
 */
import algoliasearch from 'algoliasearch';
import type { Brevet } from '../types';
import { dateToNum } from '../date';
import { mergeRecords } from './merge';

const { ALGOLIA_APP = '', ALGOLIA_WRITE = '' } = process.env;
if (!ALGOLIA_APP) throw new Error('Missing ALGOLIA_APP env variable');
if (!ALGOLIA_WRITE) throw new Error('Missing ALGOLIA_WRITE env variable');

const APPLY_ENRICH = process.argv.includes('--apply-enrich');

const today = dateToNum(new Date());

const client = algoliasearch(ALGOLIA_APP, ALGOLIA_WRITE);
const index = client.initIndex('brevets');

console.log('Browsing Algolia index...');
const records: Brevet[] = [];
await index.browseObjects<Brevet>({
  batch: (objects) => {
    records.push(...objects);
  },
});
console.log(`Fetched ${records.length} records`);

const datestamp = new Date().toISOString().slice(0, 10);
const backupPath = `index-backup-${datestamp}.json`;
await Bun.write(backupPath, JSON.stringify(records, null, 2));
console.log(`Snapshot written to ${backupPath}`);

const report = mergeRecords(records);

const inputCount = records.length;
const losersCount = report.clusters.reduce((a, c) => a + c.losers.length, 0);
const outputCount = report.records.length;
if (inputCount !== outputCount + losersCount) {
  throw new Error(
    `Count mismatch: input=${inputCount}, output=${outputCount}, losers=${losersCount}`
  );
}

type EnrichEntry = {
  winner: Brevet;
  source_objectIDs: string[];
  reason: string;
};

type DeleteEntry = {
  objectID: string;
  merged_into: string;
  reason: string;
  isPastEvent: boolean;
  loser: Brevet;
  winner: Brevet;
};

const enrichments: EnrichEntry[] = [];
const safeDeletes: DeleteEntry[] = [];
const reviewDeletes: DeleteEntry[] = [];

for (const cluster of report.clusters) {
  const allMembers = [cluster.winner, ...cluster.losers];
  enrichments.push({
    winner: cluster.winner,
    source_objectIDs: allMembers.map((m) => m.objectID),
    reason: cluster.reason,
  });

  const target = cluster.reason === 'shared city' ? safeDeletes : reviewDeletes;
  for (const loser of cluster.losers) {
    target.push({
      objectID: loser.objectID,
      merged_into: cluster.winner.objectID,
      reason: cluster.reason,
      isPastEvent: (loser.dateNumber || 0) < today,
      loser,
      winner: cluster.winner,
    });
  }
}

const winnerIDs = new Set(enrichments.map((e) => e.winner.objectID));
const loserIDs = [...safeDeletes, ...reviewDeletes].map((d) => d.objectID);
if (loserIDs.some((id) => winnerIDs.has(id))) {
  throw new Error('Sanity check failed: a winner objectID also appears in the deletion list');
}
if (new Set(loserIDs).size !== loserIDs.length) {
  throw new Error('Sanity check failed: duplicate objectIDs in the deletion list');
}

await Bun.write('dedupe-enrich.json', JSON.stringify(enrichments, null, 2));
await Bun.write('dedupe-delete-safe.json', JSON.stringify(safeDeletes, null, 2));
await Bun.write('dedupe-delete-review.json', JSON.stringify(reviewDeletes, null, 2));
await Bun.write('dedupe-ambiguous.json', JSON.stringify(report.ambiguous, null, 2));

const pastSafe = safeDeletes.filter((d) => d.isPastEvent).length;
const pastReview = reviewDeletes.filter((d) => d.isPastEvent).length;

console.log('\nReports written:');
console.log(`  dedupe-enrich.json         ${enrichments.length.toString().padStart(5)} winners`);
console.log(`  dedupe-delete-safe.json    ${safeDeletes.length.toString().padStart(5)} losers   (past events: ${pastSafe})`);
console.log(`  dedupe-delete-review.json  ${reviewDeletes.length.toString().padStart(5)} losers   (past events: ${pastReview})`);
console.log(`  dedupe-ambiguous.json      ${report.ambiguous.length.toString().padStart(5)} clusters left as separate records`);

if (APPLY_ENRICH) {
  console.log('\nApplying enrichments via saveObjects (non-destructive)...');
  const winners = enrichments.map((e) => e.winner);
  if (winners.length === 0) {
    console.log('No enrichments to apply.');
  } else {
    await index.saveObjects(winners);
    console.log(`Saved ${winners.length} merged winner records.`);
  }
  console.log('\nReview the delete-*.json files, then run:');
  console.log('  bun src/admin/delete-objects.ts dedupe-delete-safe.json --yes');
  console.log('  bun src/admin/delete-objects.ts <approved-subset-of-review> --yes');
} else {
  console.log('\nDry-run only. Nothing written to Algolia.');
  console.log('Next steps:');
  console.log('  1. Review the dedupe-*.json files.');
  console.log('  2. Re-run with --apply-enrich to push the merged winners.');
  console.log('  3. Then run delete-objects.ts with the approved deletion list.');
}
