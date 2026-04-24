import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const users = await prisma.user.findMany({
  where: { OR: [{ role: { in: ['admin','ADMIN'] } }, { email: { contains: '@terra', mode: 'insensitive' } }] },
  select: { id: true, email: true, subscriptionStatus: true, role: true, stripeCustomerId: true },
});
console.log('Admin/Terra users:', users);
await prisma.$disconnect();
