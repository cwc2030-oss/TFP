import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const users = await prisma.user.findMany();
console.log("=== ALL USERS ===");
for (const u of users) {
  console.log(`Email: ${u.email}, Role: ${u.role}, ID: ${u.id}`);
}
await prisma.$disconnect();
