import { prisma } from '../lib/db';

async function main() {
  const listings = await prisma.listing.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, title: true, status: true, state: true, county: true,
      acres: true, askingPriceMin: true, askingPriceMax: true, leaseType: true,
      description: true, ownerUserId: true, createdAt: true, publishedAt: true,
    },
  });
  console.log(`TOTAL LISTINGS: ${listings.length}\n`);
  for (const l of listings) {
    const desc = (l.description ?? '').slice(0, 60).replace(/\n/g, ' ');
    console.log(
      `[${l.status}] id=${l.id}\n  title=${JSON.stringify(l.title)} | ${l.county ?? '?'} County, ${l.state ?? '?'} | ${l.acres ?? '?'} ac | $${l.askingPriceMin}-${l.askingPriceMax} ${l.leaseType}\n  owner=${l.ownerUserId} created=${l.createdAt.toISOString()} published=${l.publishedAt?.toISOString() ?? 'null'}\n  desc=${JSON.stringify(desc)}\n`,
    );
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
