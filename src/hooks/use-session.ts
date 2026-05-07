"use client";

import { authClient } from "@/lib/auth-client";
import { useQuery } from "@tanstack/react-query";

export function useSession() {
  const { data, isPending } = useQuery({
    queryKey: ["session"],
    queryFn: () => authClient.getSession(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  return {
    user: data?.data?.user ?? null,
    session: data?.data?.session ?? null,
    isPending,
  };
}
