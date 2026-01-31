import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  // Update cwc2030@gmail.com to admin
  const updated = await prisma.user.update({
    where: { email: 'cwc2030@gmail.com' },
    data: { role: 'admin' }
  });
  console.log(`✅ Updated ${updated.email} to admin role`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
