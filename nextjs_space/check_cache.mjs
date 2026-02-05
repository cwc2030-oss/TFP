import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const caches = await prisma.parcelCache.findMany({ take: 5 });
console.log("Cached parcels:", caches.length);
for (const c of caches) {
  console.log("Lat:", c.lat, "Lng:", c.lng);
  const data = JSON.parse(c.data);
  console.log("  County:", data.county, "Acres:", data.acreage || data.ll_gisacre);
}
await prisma.$disconnect();
