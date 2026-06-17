const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({
  datasources: {
    db: {
      url: 'file:/Volumes/My Shared Files/Dev/busyreader-via-pi/prisma/dev.db'
    }
  }
});

db.userBookAccess.findMany({
  where: { userId: 'nPKJZBkPNjkKyWxACRUxYywkmGKjlHVN' },
  include: { book: true }
}).then(r => {
  console.log('Explicit DS count:', r.length);
  r.forEach((a, i) => console.log(i+1, a.book.title));
  db.\u0024disconnect();
});
