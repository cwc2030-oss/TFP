import { prisma } from '../lib/db';

// Explicit ID allow-list of clearly-garbage PUBLISHED test listings
// (gibberish titles or TEST/gibberish descriptions, owned by the test/dev
// accounts, zero inquiries). Hard-deleting by explicit ID only — no wildcard
// so there is zero risk of removing a real listing.
const GARBAGE_IDS = [
  'cmr9wlrxk000umr08b9e21alt', // "sasdf  title" (directive-flagged)
  'cmr8h79ft000uox0860zrgph0', // "Kirksville whitetail" desc "TEST vgkkf..."
  'cmr8597w20024qm082gztn63h', // "deer village" desc "TEST..."
  'cmr84l2r000aknq0821sawpm4', // "whitetail woods" desc "moldkgodfodff..."
  'cmr849184009ynq08lru7zq67', // "deer" desc "dfgadfhdfgj..."
  'cmr842nha009dnq08k9oa6ix1', // "Oklahom deer hunting" desc "terrain asdgfapsdop..."
  'cmr72bjsd0021p308xfr5upcd', // "hunt a thon" desc "sdasdgdfg..."
  'cmr725es10010p308o1bceiud', // "Deer Mecca" desc "lgknlkasdglksd..."
  'cmr6ytlh400bxmo09pqz9b3fu', // gibberish title "gfhefghsdfhsdh..."
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const targets = await prisma.listing.findMany({
    where: { id: { in: GARBAGE_IDS } },
    select: { id: true, title: true, status: true, ownerUserId: true },
  });
  console.log(`Matched ${targets.length}/${GARBAGE_IDS.length} target rows:`);
  for (const t of targets) console.log(`  [${t.status}] ${t.id} ${JSON.stringify(t.title)}`);

  // Safety: ensure none have inquiries (should be zero globally).
  const inqCount = await prisma.inquiry.count({ where: { listingId: { in: GARBAGE_IDS } } });
  console.log(`\nInquiries referencing these listings: ${inqCount}`);
  if (inqCount > 0) {
    console.error('ABORT: some target listings have inquiries. Not deleting.');
    process.exit(1);
  }

  if (dryRun) {
    console.log('\n[DRY RUN] No rows deleted.');
    return;
  }

  const res = await prisma.listing.deleteMany({ where: { id: { in: GARBAGE_IDS } } });
  console.log(`\nDELETED ${res.count} listing rows.`);

  const remainingPublished = await prisma.listing.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: { publishedAt: 'desc' },
    select: { id: true, title: true, county: true, state: true, acres: true },
  });
  console.log(`\nRemaining PUBLISHED listings (${remainingPublished.length}):`);
  for (const l of remainingPublished) {
    console.log(`  ${l.id} ${JSON.stringify(l.title)} | ${l.county} County, ${l.state} | ${l.acres} ac`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
