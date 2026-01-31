import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Get all users
  const users = await prisma.user.findMany();
  console.log('Current users:');
  users.forEach(user => {
    console.log(`- ${user.email} (role: ${user.role})`);
  });
  
  if (users.length > 0) {
    // Update the first user to admin
    const firstUser = users[0];
    const updated = await prisma.user.update({
      where: { id: firstUser.id },
      data: { role: 'admin' }
    });
    console.log(`\n✅ Updated ${updated.email} to admin role`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
