"use client";

import { useCallback, useMemo } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  PlaylistItem,
  PlaylistBookMeta,
  PlaylistSnapshot,
} from "@/types/playlist";

const QUERY_KEY = ["playlist"];

async function fetchPlaylist(): Promise<PlaylistSnapshot> {
  const res = await fetch("/api/playlist");
  if (!res.ok) {
    throw new Error(`Failed to load playlist: ${res.status}`);
  }
  return res.json() as Promise<PlaylistSnapshot>;
}

export function usePlaylist() {
  const { data, isPending, error } = useQuery<PlaylistSnapshot>({
    queryKey: QUERY_KEY,
    queryFn: fetchPlaylist,
    staleTime: Infinity,
  });
  return {
    items: data?.items ?? [],
    autoAdvanceBook: data?.autoAdvanceBook ?? true,
    isPending,
    error,
  };
}

export function useActivePlaylistItem(): PlaylistItem | null {
  const { items } = usePlaylist();
  return items.find((i) => i.status === "active") ?? null;
}

export function usePlaylistGroups() {
  const { items } = usePlaylist();
  const history = items.filter((i) => i.status === "history");
  const active = items.find((i) => i.status === "active") ?? null;
  const upcoming = items.filter((i) => i.status === "upcoming");
  return { history, active, upcoming };
}

export function useAddPlaylistItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      bookId: string;
      sectionHref: string;
      sectionLabel: string;
      mode: "next" | "last";
    } & PlaylistBookMeta) => {
      const res = await fetch("/api/playlist/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`Failed to add playlist item: ${res.status}`);
      }
      const data = (await res.json()) as { item: PlaylistItem };
      return data.item;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useActivatePlaylistItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/playlist/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate" }),
      });
      if (!res.ok) {
        throw new Error(`Failed to activate playlist item: ${res.status}`);
      }
      const data = (await res.json()) as { item: PlaylistItem };
      return data.item;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useRemovePlaylistItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/playlist/items/${itemId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(`Failed to remove playlist item: ${res.status}`);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useClearPlaylist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (scope: "all" | "upcoming") => {
      const res = await fetch("/api/playlist/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (!res.ok) {
        throw new Error(`Failed to clear playlist: ${res.status}`);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useReorderPlaylist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const res = await fetch("/api/playlist/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });
      if (!res.ok) {
        throw new Error(`Failed to reorder playlist: ${res.status}`);
      }
    },
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<PlaylistSnapshot>(QUERY_KEY);
      if (previous) {
        const active = previous.items.find((i) => i.status === "active");
        const history = previous.items.filter((i) => i.status === "history");
        const upcomingById = new Map(
          previous.items
            .filter((i) => i.status === "upcoming")
            .map((i) => [i.id, i]),
        );
        const reordered = orderedIds
          .map((id) => upcomingById.get(id))
          .filter(Boolean) as PlaylistItem[];
        queryClient.setQueryData<PlaylistSnapshot>(QUERY_KEY, {
          ...previous,
          items: [...history, ...(active ? [active] : []), ...reordered],
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData<PlaylistSnapshot>(QUERY_KEY, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useSetAutoAdvance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (autoAdvanceBook: boolean) => {
      const res = await fetch("/api/playlist/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoAdvanceBook }),
      });
      if (!res.ok) {
        throw new Error(`Failed to update setting: ${res.status}`);
      }
      const data = (await res.json()) as { autoAdvanceBook: boolean };
      return data.autoAdvanceBook;
    },
    onMutate: async (autoAdvanceBook) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<PlaylistSnapshot>(QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<PlaylistSnapshot>(QUERY_KEY, {
          ...previous,
          autoAdvanceBook,
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData<PlaylistSnapshot>(QUERY_KEY, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function usePlaylistMutations() {
  const add = useAddPlaylistItem();
  const activate = useActivatePlaylistItem();
  const remove = useRemovePlaylistItem();
  const clear = useClearPlaylist();
  const reorder = useReorderPlaylist();
  const setAutoAdvance = useSetAutoAdvance();

  return useMemo(
    () => ({
      addItem: add.mutateAsync,
      activateItem: activate.mutateAsync,
      removeItem: remove.mutateAsync,
      clear: clear.mutateAsync,
      reorder: reorder.mutateAsync,
      setAutoAdvance: setAutoAdvance.mutateAsync,
      isPending:
        add.isPending ||
        activate.isPending ||
        remove.isPending ||
        clear.isPending ||
        reorder.isPending ||
        setAutoAdvance.isPending,
    }),
    [add, activate, remove, clear, reorder, setAutoAdvance],
  );
}
