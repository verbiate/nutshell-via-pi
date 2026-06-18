import { Badge } from "@/components/ui/badge";
import { Shield } from "lucide-react";
import type { UserRole } from "@/types/book";

interface RoleBadgeProps {
  role: UserRole;
}

export function RoleBadge({ role }: RoleBadgeProps) {
  switch (role) {
    case "admin":
      return (
        <Badge variant="outline" className="gap-1">
          <Shield className="h-3 w-3" />
          Admin
        </Badge>
      );
    case "pro":
      return <Badge className="bg-primary text-white">Pro</Badge>;
    case "regular":
    default:
      return null;
  }
}
