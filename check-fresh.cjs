// Force a fresh PrismaClient without global cache
const { PrismaClient } = require('@prisma/client');

// Wipe global cache
if (globalThis.prisma) {
  globalThis.prisma = undefined;
}

const db = new PrismaClient({
  datasources: {
    db: {
      url: 'file:/Volumes/My Shared Files/Dev/busyreader-via-pi/prisma/dev.db'
    }
  }
});

db.userBookAccess.findMany({
  where: { userId: 'nPKJZBkPNjkKyWxACRUxYywkmGKjlHVN' }
}).then(r => {
  console.log('Fresh client count:', r.length);
  r.forEach((a, i) => console.log(i+1, a.bookId));
  db.\u0024disconnect();
});
