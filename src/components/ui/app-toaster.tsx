"use client";

import { usePathname } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";

export function AppToaster() {
  const pathname = usePathname();
  const position = pathname?.startsWith("/admin") ? "top-right" : "bottom-right";
  return <Toaster position={position} />;
}
