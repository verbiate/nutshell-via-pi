import { requireAuth } from "@/lib/auth-guards";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Shield } from "lucide-react";
import type { UserRole } from "@/types/book";

function RoleBadge({ role }: { role: UserRole }) {
  switch (role) {
    case "admin":
      return (
        <Badge variant="outline" className="gap-1">
          <Shield className="h-3 w-3" />
          Admin
        </Badge>
      );
    case "pro":
      return <Badge className="bg-slate-900 text-white">Pro</Badge>;
    case "regular":
      return <Badge variant="secondary">Regular</Badge>;
  }
}

export default async function ProfilePage() {
  const user = await requireAuth();

  const initials = user.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase() || "U";

  return (
    <div className="mx-auto max-w-lg py-12">
      <div className="flex items-center gap-6">
        <Avatar size="lg" className="h-20 w-20">
          <AvatarImage src={user.image || undefined} alt={user.name || ""} />
          <AvatarFallback className="bg-slate-200 text-xl">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-[28px] font-semibold text-slate-900">
            {user.name || "User"}
          </h1>
          <p className="mt-1 text-base text-muted-foreground">{user.email}</p>
          <div className="mt-2 flex items-center gap-3">
            <RoleBadge role={user.role} />
            {user.role === "regular" && (
              <span className="text-sm text-muted-foreground cursor-not-allowed">
                Upgrade to Pro
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
