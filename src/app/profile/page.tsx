import { requireAuth } from "@/lib/auth-guards";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { RoleBadge } from "@/components/auth/role-badge";

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
          <AvatarFallback className="bg-muted text-xl">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-[28px] font-semibold text-foreground">
            {user.name || "User"}
          </h1>
          <p className="mt-1 text-base text-muted-foreground">{user.email}</p>
          <div className="mt-2 flex items-center gap-3">
            {user.role === "regular" ? (
              <Badge variant="secondary">Regular</Badge>
            ) : (
              <RoleBadge role={user.role} />
            )}
            {user.role === "regular" && (
              <span className="cursor-not-allowed text-sm text-muted-foreground">
                Upgrade to Pro
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
