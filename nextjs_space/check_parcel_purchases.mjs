import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const clark = await prisma.user.findFirst({
  where: { email: { contains: 'clark', mode: 'insensitive' } },
  select: { id: true, email: true, subscriptionStatus: true, stripeCustomerId: true, role: true },
});
console.log('Clark user:', clark);

if (clark) {
  const purchases = await prisma.parcelPurchase.findMany({
    where: { userId: clark.id },
    orderBy: { purchasedAt: 'desc' },
  });
  console.log('\nParcelPurchases for Clark (' + purchases.length + ' total):');
  purchases.forEach((p, i) => console.log('  ' + (i+1) + '. ' + p.purchasedAt.toISOString() + ' | ' + p.parcelAddress + ' | session=' + p.stripeSessionId + ' | amount=' + p.amount));
}

const total = await prisma.parcelPurchase.count();
console.log('\nTotal ParcelPurchase rows in DB: ' + total);

await prisma.$disconnect();
