import { db } from "@/server/db";

// ponytail: KV helpers over AppSetting. Two functions cover all current callers
// (globalSystemPrompt now, future global flags later). Add typed wrappers here
// if a key grows non-trivial validation, don't bypass these helpers.

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(
  key: string,
  value: string | null
): Promise<void> {
  await db.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}
