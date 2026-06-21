// One-time script: promote Clark (cwc2030@gmail.com) to Pro Max tier directly in DB.
// Owner/admin should always reflect active Pro Max on the live site.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = 'cwc2030@gmail.com';

  // Look up first to confirm user exists & show before-state.
  const before = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      role: true,
      subscriptionStatus: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stripePriceId: true,
      subscriptionEnds: true,
    },
  });

  if (!before) {
    console.error(`[promote] No user found with email ${email}`);
    process.exit(1);
  }

  console.log('[promote] BEFORE:', JSON.stringify(before, null, 2));

  // Set subscriptionEnds to 10 years out — owner perpetual access.
  const tenYearsOut = new Date();
  tenYearsOut.setFullYear(tenYearsOut.getFullYear() + 10);

  const after = await prisma.user.update({
    where: { email },
    data: {
      subscriptionStatus: 'promax',
      subscriptionEnds: tenYearsOut,
      role: 'admin', // ensure admin role too
    },
    select: {
      id: true,
      email: true,
      role: true,
      subscriptionStatus: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stripePriceId: true,
      subscriptionEnds: true,
    },
  });

  console.log('[promote] AFTER:', JSON.stringify(after, null, 2));
  console.log('[promote] \u2705 Clark is now Pro Max tier (perpetual).');
}

main()
  .catch((e) => {
    console.error('[promote] FAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
