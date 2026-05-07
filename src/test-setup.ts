// Test setup — extend as needed
process.env.DATABASE_URL = "file:./test.db";
process.env.BETTER_AUTH_SECRET = "test-secret-for-vitest-only";
process.env.STORAGE_PATH = "./test-uploads";
