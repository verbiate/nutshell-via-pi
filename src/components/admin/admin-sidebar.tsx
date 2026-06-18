"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Library, FileText, ScrollText, Key } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Users", icon: Users, href: "/admin/users" },
  { label: "Universal Library", icon: Library, href: "/admin/books" },
  { label: "Prompt Templates", icon: FileText, href: "/admin/prompts" },
  { label: "Audit Log", icon: ScrollText, href: "/admin/audit" },
  { label: "API Keys & Models", icon: Key, href: "/admin/config" },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-3">
      {NAV_ITEMS.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex h-10 items-center gap-2 rounded-md px-4 text-sm",
              isActive
                ? "bg-primary text-white border-l-[3px] border-primary"
                : "text-muted-foreground hover:bg-muted border-l-[3px] border-transparent"
            )}
          >
            <item.icon className="h-[18px] w-[18px]" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
