import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const PRO_MONTHLY = 'price_1TM7lRCjOK9CKFruUtcZBuzA';
const PRO_ANNUAL  = 'price_1TM7iXCjOK9CKFruXstxlL2e';
const PROMAX_MONTHLY = 'price_1TMukZCjOK9CKFruSNqFzG8r';
const PROMAX_ANNUAL  = 'price_1TMuhSCjOK9CKFruz6PR8tvR';

(async () => {
  // 1. One-time parcel unlocks
  const parcelPurchases = await prisma.parcelPurchase.findMany({
    include: { user: { select: { email: true, role: true } } },
    orderBy: { purchasedAt: 'desc' },
  });
  const uniqueParcelBuyers = new Set(parcelPurchases.map(p => p.userId)).size;

  // 2. Pro tier (subscriptionStatus = "pro")
  const proUsers = await prisma.user.findMany({
    where: { subscriptionStatus: 'pro' },
    select: {
      id: true,
      email: true,
      role: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stripePriceId: true,
      subscriptionEnds: true,
      createdAt: true,
    },
  });

  // 3. Pro Max tier (subscriptionStatus = "promax")
  const proMaxUsers = await prisma.user.findMany({
    where: { subscriptionStatus: 'promax' },
    select: {
      id: true,
      email: true,
      role: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stripePriceId: true,
      subscriptionEnds: true,
      createdAt: true,
    },
  });

  console.log('=== TerraFirma Paid User Counts ===\n');

  console.log('1. One-time Parcel Unlocks ($19 each):');
  console.log('   Total purchases:', parcelPurchases.length);
  console.log('   Unique buyers:  ', uniqueParcelBuyers);
  console.log('   Revenue: $' + (parcelPurchases.length * 19).toFixed(2));
  if (parcelPurchases.length > 0) {
    console.log('   Buyers:');
    const seen = new Set();
    parcelPurchases.forEach(p => {
      const key = `${p.user?.email || 'unknown'}:${p.purchasedAt.toISOString().slice(0, 10)}`;
      if (!seen.has(p.userId + p.parcelLat)) {
        seen.add(p.userId + p.parcelLat);
      }
      console.log(`   - ${p.user?.email || 'no user'} | ${p.parcelAddress?.slice(0, 50) || 'no addr'} | ${p.purchasedAt.toISOString().slice(0, 10)} | ${p.stripeSessionId ? 'real' : 'no-session'}`);
    });
  }
  console.log();

  console.log('2. Pro Subscribers (subscriptionStatus=pro):', proUsers.length);
  proUsers.forEach(u => {
    const isAdmin = u.role === 'admin';
    const isReal = !!u.stripeSubscriptionId;
    const tag = [
      isAdmin ? 'ADMIN-GRANT' : '',
      isReal ? 'real-stripe' : 'manual-grant',
    ].filter(Boolean).join('|');
    const tier = u.stripePriceId === PRO_ANNUAL ? 'annual' : u.stripePriceId === PRO_MONTHLY ? 'monthly' : 'no-price';
    console.log(`   - ${u.email} | ${tag} | ${tier} | ends: ${u.subscriptionEnds?.toISOString().slice(0,10) || 'n/a'}`);
  });
  console.log();

  console.log('3. Pro Max Subscribers (subscriptionStatus=promax):', proMaxUsers.length);
  proMaxUsers.forEach(u => {
    const isAdmin = u.role === 'admin';
    const isReal = !!u.stripeSubscriptionId;
    const tag = [
      isAdmin ? 'ADMIN-GRANT' : '',
      isReal ? 'real-stripe' : 'manual-grant',
    ].filter(Boolean).join('|');
    const tier = u.stripePriceId === PROMAX_ANNUAL ? 'annual' : u.stripePriceId === PROMAX_MONTHLY ? 'monthly' : 'no-price';
    console.log(`   - ${u.email} | ${tag} | ${tier} | ends: ${u.subscriptionEnds?.toISOString().slice(0,10) || 'n/a'}`);
  });
  console.log();

  // Real (Stripe-paying) counts only
  const realPro = proUsers.filter(u => u.stripeSubscriptionId).length;
  const realProMax = proMaxUsers.filter(u => u.stripeSubscriptionId).length;
  console.log('=== STRIPE-PAYING ONLY (real customers) ===');
  console.log('Pro:    ', realPro);
  console.log('Pro Max:', realProMax);
  console.log('Parcel unlocks:', parcelPurchases.filter(p => p.stripeSessionId).length);
  console.log();

  // Total user counts
  const totalUsers = await prisma.user.count();
  console.log('Total registered users:', totalUsers);

  await prisma.$disconnect();
})();
