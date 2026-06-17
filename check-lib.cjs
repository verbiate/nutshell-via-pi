const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
db.userBookAccess.findMany({
  where: { userId: 'nPKJZBkPNjkKyWxACRUxYywkmGKjlHVN' },
  include: { book: true }
}).then(r => {
  console.log('Count:', r.length);
  r.forEach((a, i) => console.log((i+1) + '.', a.book.title, '-', a.book.id));
  return db.\u0024disconnect();
});
