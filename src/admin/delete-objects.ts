/**
 * Delete a list of objectIDs from the Algolia 'brevets' index.
 *
 * Input file can be:
 *   - JSON array of strings: ["id1", "id2", ...]
 *   - JSON array of objects with `objectID`: [{ "objectID": "id1", ... }, ...]
 *     (this is what dedupe-index.ts emits in dedupe-delete-*.json)
 *   - one objectID per line (plain text)
 *
 * Safety:
 *   - Refuses to run if no index-backup-*.json exists in the working directory
 *     less than 7 days old. Re-run dedupe-index.ts first.
 *   - Requires the --yes flag to actually delete (review the file first).
 *
 * Usage:
 *   bun src/admin/delete-objects.ts <path-to-file>          # prints what would happen
 *   bun src/admin/delete-objects.ts <path-to-file> --yes    # actually deletes
 */
import algoliasearch from 'algoliasearch';
import fs from 'node:fs';

const { ALGOLIA_APP = '', ALGOLIA_WRITE = '' } = process.env;
if (!ALGOLIA_APP) throw new Error('Missing ALGOLIA_APP env variable');
if (!ALGOLIA_WRITE) throw new Error('Missing ALGOLIA_WRITE env variable');

const args = process.argv.slice(2);
const YES = args.includes('--yes');
const inputFile = args.find((a) => !a.startsWith('--'));

if (!inputFile) {
  console.error('Usage: bun src/admin/delete-objects.ts <path-to-file> [--yes]');
  console.error('File can be a JSON array of objectIDs, an array of {objectID, ...} objects,');
  console.error('or one objectID per line.');
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}`);
  process.exit(1);
}

const backups = fs
  .readdirSync('.')
  .filter((f) => /^index-backup-\d{4}-\d{2}-\d{2}\.json$/.test(f));
if (backups.length === 0) {
  console.error('Refusing to delete: no index-backup-YYYY-MM-DD.json found in the current directory.');
  console.error('Run dedupe-index.ts first to take a snapshot.');
  process.exit(1);
}
const newestBackup = [...backups].sort().reverse()[0];
const backupDateStr = newestBackup.match(/(\d{4}-\d{2}-\d{2})/)![1];
const ageDays = (Date.now() - new Date(backupDateStr).getTime()) / 86_400_000;
if (ageDays > 7) {
  console.error(
    `Refusing to delete: newest backup ${newestBackup} is ${ageDays.toFixed(1)} days old.`
  );
  console.error('Re-run dedupe-index.ts to take a fresh snapshot first.');
  process.exit(1);
}

const raw = fs.readFileSync(inputFile, 'utf8').trim();
let ids: string[];
try {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('expected a JSON array');
  }
  if (parsed.length === 0) {
    ids = [];
  } else if (typeof parsed[0] === 'string') {
    ids = parsed as string[];
  } else if (typeof parsed[0] === 'object' && parsed[0] !== null && 'objectID' in parsed[0]) {
    ids = (parsed as Array<{ objectID: string }>).map((p) => p.objectID);
  } else {
    throw new Error('expected array of strings or array of { objectID }');
  }
} catch {
  ids = raw.split('\n').map((l) => l.trim()).filter(Boolean);
}

ids = [...new Set(ids)];

if (ids.length === 0) {
  console.log('No objectIDs to delete.');
  process.exit(0);
}

console.log(`Input file:        ${inputFile}`);
console.log(`Newest backup:     ${newestBackup} (${ageDays.toFixed(1)} days old)`);
console.log(`objectIDs to delete: ${ids.length}`);
console.log(`First 5:           ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ', ...' : ''}`);

if (!YES) {
  console.log('\nNot deleting. Re-run with --yes to confirm.');
  process.exit(0);
}

const client = algoliasearch(ALGOLIA_APP, ALGOLIA_WRITE);
const index = client.initIndex('brevets');

const BATCH = 1000;
for (let i = 0; i < ids.length; i += BATCH) {
  const batch = ids.slice(i, i + BATCH);
  await index.deleteObjects(batch);
  console.log(`Deleted ${Math.min(i + batch.length, ids.length)} / ${ids.length}`);
}
console.log('Done.');
