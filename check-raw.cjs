const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function main() {
  // Raw SQL
  const raw = await db.\u0024queryRaw`SELECT * FROM UserBookAccess WHERE userId = 'nPKJZBkPNjkKyWxACRUxYywkmGKjlHVN'`;
  console.log('Raw SQL count:', raw.length);
  raw.forEach((r, i) => console.log(i+1, r.bookId));
  
  // Prisma ORM
  const orm = await db.userBookAccess.findMany({
    where: { userId: 'nPKJZBkPNjkKyWxACRUxYywkmGKjlHVN' }
  });
  console.log('ORM count:', orm.length);
  orm.forEach((r, i) => console.log(i+1, r.bookId));
  
  await db.\u0024disconnect();
}

main();
