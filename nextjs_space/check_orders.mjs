import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const orders = await prisma.order.findMany({
  orderBy: { createdAt: 'desc' },
  take: 5,
  select: {
    id: true,
    parcelAddress: true,
    parcelLat: true,
    parcelLng: true,
    status: true,
    createdAt: true
  }
});
console.log(JSON.stringify(orders, null, 2));
await prisma.$disconnect();
