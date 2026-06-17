const { execSync } = require('child_process');
const result = execSync("sqlite3 '/Volumes/My Shared Files/Dev/busyreader-via-pi/prisma/dev.db' \"SELECT id, bookId FROM UserBookAccess WHERE userId = 'nPKJZBkPNjkKyWxACRUxYywkmGKjlHVN';\"", { encoding: 'utf8' });
console.log('sqlite3 CLI from Node:');
console.log(result.trim() || '(no output)');
console.log('Row count:', result.trim().split('\n').filter(Boolean).length);
