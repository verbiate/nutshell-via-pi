import { db } from "@/server/db";
import type {
  PlaylistItem,
  PlaylistItemStatus,
  PlaylistItemKind,
  PlaylistBookMeta,
} from "@/types/playlist";

export const PLAYLIST_MAX_ITEMS = 50;
export type { PlaylistItem, PlaylistItemStatus, PlaylistItemKind, PlaylistBookMeta };

function toPlaylistItem(row: {
  id: string;
  userId: string;
  kind: string;
  bookId: string | null;
  sectionHref: string | null;
  sectionLabel: string | null;
  text: string | null;
  position: number;
  status: string;
  bookTitle: string | null;
  bookAuthor: string | null;
  bookCoverPath: string | null;
  bookLanguage: string;
  addedAt: Date;
  playedAt: Date | null;
}): PlaylistItem {
  return {
    ...row,
    kind: row.kind as PlaylistItemKind,
    addedAt: row.addedAt.toISOString(),
    playedAt: row.playedAt?.toISOString() ?? null,
    status: row.status as PlaylistItemStatus,
  };
}

export async function getPlaylist(userId: string): Promise<PlaylistItem[]> {
  const rows = await db.playlistItem.findMany({
    where: { userId },
    orderBy: { position: "asc" },
  });
  return rows.map(toPlaylistItem);
}

export async function getAutoAdvance(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { playlistAutoAdvance: true },
  });
  return user?.playlistAutoAdvance ?? true;
}

export async function setAutoAdvance(
  userId: string,
  value: boolean,
): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { playlistAutoAdvance: value },
  });
}

export async function addItem(
  userId: string,
  data: {
    mode: "next" | "last";
    sectionLabel: string;
    // Section tracks: kind defaults to "section" when sectionHref is present.
    kind?: PlaylistItemKind;
    bookId?: string;
    sectionHref?: string;
    // Text tracks: the full text to speak.
    text?: string;
  } & PlaylistBookMeta,
): Promise<PlaylistItem> {
  const active = await db.playlistItem.findFirst({
    where: { userId, status: "active" },
  });
  const activePosition = active?.position ?? -1;

  let insertPosition: number;
  if (data.mode === "next") {
    insertPosition = activePosition + 1;
  } else {
    const maxRow = await db.playlistItem.findFirst({
      where: { userId },
      orderBy: { position: "desc" },
    });
    insertPosition = (maxRow?.position ?? -1) + 1;
  }

  await shiftPositions(userId, insertPosition, 1);

  const kind: PlaylistItemKind = data.kind ?? (data.sectionHref ? "section" : "text");

  const created = await db.playlistItem.create({
    data: {
      userId,
      kind,
      bookId: data.bookId ?? null,
      sectionHref: data.sectionHref ?? null,
      sectionLabel: data.sectionLabel,
      text: kind === "text" ? (data.text ?? "") : null,
      position: insertPosition,
      status: "upcoming",
      bookTitle: data.bookTitle ?? null,
      bookAuthor: data.bookAuthor ?? null,
      bookCoverPath: data.bookCoverPath ?? null,
      bookLanguage: data.bookLanguage ?? "und",
    },
  });

  await trimHistory(userId);
  return toPlaylistItem(created);
}

export async function activateItem(
  userId: string,
  itemId: string,
): Promise<PlaylistItem> {
  const target = await db.playlistItem.findUnique({ where: { id: itemId } });
  if (!target || target.userId !== userId) {
    throw new Error("Playlist item not found");
  }
  if (target.status === "active") {
    return toPlaylistItem(target);
  }

  await db.$transaction(async (tx) => {
    const items = await tx.playlistItem.findMany({
      where: { userId },
      orderBy: { position: "asc" },
    });
    const now = new Date();

    for (const item of items) {
      let status = item.status as PlaylistItemStatus;
      let playedAt = item.playedAt;

      if (item.id === target.id) {
        status = "active";
        playedAt = null;
      } else if (item.position < target.position) {
        if (status !== "history") {
          status = "history";
          playedAt = now;
        }
      } else {
        status = "upcoming";
        playedAt = null;
      }

      if (
        status !== item.status ||
        playedAt?.getTime() !== item.playedAt?.getTime()
      ) {
        await tx.playlistItem.update({
          where: { id: item.id },
          data: { status, playedAt },
        });
      }
    }
  });

  await trimHistory(userId);

  const refreshed = await db.playlistItem.findUniqueOrThrow({
    where: { id: itemId },
  });
  return toPlaylistItem(refreshed);
}

/**
 * Atomically promote a section to active: insert it as a NEW active row right
 * after the current active, demote the current active to history, and shift
 * everything after up by one — all in a single transaction.
 *
 * This is the ghost-promotion path. It differs from addItem+activateItem in
 * two critical ways:
 *  - Single transaction -> one client refetch -> no intermediate "upcoming"
 *    render (the flash when the new row briefly appeared in the queue before
 *    becoming active).
 *  - Inserted right after the active item (not at the end), and only the old
 *    active is demoted. activateItem's "everything before the target becomes
 *    history" rule would wipe the user's manual queue when the new row lands
 *    at the end; this preserves queued items as upcoming.
 */
export async function promoteItem(
  userId: string,
  data: {
    bookId: string;
    sectionHref: string;
    sectionLabel: string;
  } & PlaylistBookMeta,
): Promise<PlaylistItem> {
  const created = await db.$transaction(async (tx) => {
    const active = await tx.playlistItem.findFirst({
      where: { userId, status: "active" },
    });
    const insertPosition = (active?.position ?? -1) + 1;

    // Make room: shift items at/after insertPosition up by 1, highest
    // position first. The (userId, position) unique constraint means an
    // ascending-order shift would transiently collide two rows on one key.
    const toShift = await tx.playlistItem.findMany({
      where: { userId, position: { gte: insertPosition } },
      orderBy: { position: "desc" },
    });
    for (const item of toShift) {
      await tx.playlistItem.update({
        where: { id: item.id },
        data: { position: item.position + 1 },
      });
    }

    // Demote the current active to history (only it — the queue is preserved).
    if (active) {
      await tx.playlistItem.update({
        where: { id: active.id },
        data: { status: "history", playedAt: new Date() },
      });
    }

    // Create the promoted section as the new active at insertPosition.
    return tx.playlistItem.create({
      data: {
        userId,
        bookId: data.bookId,
        sectionHref: data.sectionHref,
        sectionLabel: data.sectionLabel,
        position: insertPosition,
        status: "active",
        bookTitle: data.bookTitle ?? null,
        bookAuthor: data.bookAuthor ?? null,
        bookCoverPath: data.bookCoverPath ?? null,
        bookLanguage: data.bookLanguage ?? "und",
      },
    });
  });

  await trimHistory(userId);
  return toPlaylistItem(created);
}

export async function removeItem(
  userId: string,
  itemId: string,
): Promise<void> {
  const item = await db.playlistItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== userId) {
    throw new Error("Playlist item not found");
  }

  await db.$transaction(async (tx) => {
    await tx.playlistItem.delete({ where: { id: itemId } });
    const after = await tx.playlistItem.findMany({
      where: { userId, position: { gt: item.position } },
      orderBy: { position: "asc" },
    });
    for (const it of after) {
      await tx.playlistItem.update({
        where: { id: it.id },
        data: { position: it.position - 1 },
      });
    }
  });
}

export async function clearPlaylist(
  userId: string,
  scope: "all" | "upcoming",
): Promise<void> {
  if (scope === "all") {
    await db.playlistItem.deleteMany({ where: { userId } });
    return;
  }

  await db.$transaction(async (tx) => {
    await tx.playlistItem.deleteMany({ where: { userId, status: "upcoming" } });
    const remaining = await tx.playlistItem.findMany({
      where: { userId },
      orderBy: { position: "asc" },
    });
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].position !== i) {
        await tx.playlistItem.update({
          where: { id: remaining[i].id },
          data: { position: i },
        });
      }
    }
  });
}

export async function reorderUpcoming(
  userId: string,
  orderedIds: string[],
): Promise<void> {
  if (orderedIds.length === 0) return;

  const active = await db.playlistItem.findFirst({
    where: { userId, status: "active" },
  });
  if (!active) {
    throw new Error("No active playlist item");
  }

  const upcoming = await db.playlistItem.findMany({
    where: { userId, status: "upcoming" },
    orderBy: { position: "asc" },
  });
  const upcomingIds = new Set(upcoming.map((u) => u.id));
  if (
    orderedIds.length !== upcoming.length ||
    !orderedIds.every((id) => upcomingIds.has(id))
  ) {
    throw new Error("Invalid upcoming item order");
  }

  await db.$transaction(async (tx) => {
    let position = active.position + 1;
    for (const id of orderedIds) {
      await tx.playlistItem.update({
        where: { id },
        data: { position },
      });
      position++;
    }
  });
}

async function shiftPositions(
  userId: string,
  from: number,
  delta: number,
): Promise<void> {
  if (delta <= 0) return;
  const items = await db.playlistItem.findMany({
    where: { userId, position: { gte: from } },
    orderBy: { position: "desc" },
  });
  for (const item of items) {
    await db.playlistItem.update({
      where: { id: item.id },
      data: { position: item.position + delta },
    });
  }
}

async function trimHistory(userId: string): Promise<void> {
  const count = await db.playlistItem.count({ where: { userId } });
  if (count <= PLAYLIST_MAX_ITEMS) return;

  const excess = count - PLAYLIST_MAX_ITEMS;
  const deletable: { id: string }[] = [];

  const history = await db.playlistItem.findMany({
    where: { userId, status: "history" },
    orderBy: { playedAt: "asc" },
    take: excess,
  });
  deletable.push(...history);

  if (deletable.length < excess) {
    const stillExcess = excess - deletable.length;
    const upcoming = await db.playlistItem.findMany({
      where: { userId, status: "upcoming" },
      orderBy: { position: "asc" },
      take: stillExcess,
    });
    deletable.push(...upcoming);
  }

  if (deletable.length > 0) {
    await db.$transaction(async (tx) => {
      await tx.playlistItem.deleteMany({
        where: { id: { in: deletable.map((d) => d.id) } },
      });
      const remaining = await tx.playlistItem.findMany({
        where: { userId },
        orderBy: { position: "asc" },
      });
      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].position !== i) {
          await tx.playlistItem.update({
            where: { id: remaining[i].id },
            data: { position: i },
          });
        }
      }
    });
  }
}
