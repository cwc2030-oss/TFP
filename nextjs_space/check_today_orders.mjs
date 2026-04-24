import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const start = new Date();
start.setDate(start.getDate() - 2); // last 2 days

// All recent ParcelPurchases ($19 flow)
const pp = await prisma.parcelPurchase.findMany({
  where: { purchasedAt: { gte: start } },
  orderBy: { purchasedAt: 'desc' },
});
console.log('=== ParcelPurchase rows (last 2 days) — the $19 flow ===');
console.log('Total:', pp.length);
pp.forEach((p, i) => console.log(`  ${i+1}. ${p.purchasedAt.toISOString()} | user=${p.userId} | $${p.amount/100} | session=${p.stripeSessionId || '(none yet)'} | addr=${p.parcelAddress}`));

// All recent Orders ($149/$49 flow)
const orders = await prisma.order.findMany({
  where: { createdAt: { gte: start } },
  orderBy: { createdAt: 'desc' },
});
console.log('\n=== Order rows (last 2 days) — the $149/$49 flow ===');
console.log('Total:', orders.length);
orders.forEach((o, i) => console.log(`  ${i+1}. ${o.createdAt.toISOString()} | user=${o.userId||'guest'} | productType=${o.productType} | price=$${o.price/100} | status=${o.status} | intentId=${o.paymentIntentId} | addr=${o.parcelAddress}`));

await prisma.$disconnect();
