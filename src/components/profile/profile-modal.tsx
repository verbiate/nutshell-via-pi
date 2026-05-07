"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Shield } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { LANGUAGES, getLanguageName } from "@/lib/languages";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { UserRole } from "@/types/book";

interface ProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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

export function ProfileModal({ open, onOpenChange }: ProfileModalProps) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [preferredLanguage, setPreferredLanguage] = useState(
    (user as any)?.preferredLanguage || "en"
  );
  const [isSaving, setIsSaving] = useState(false);

  const role = ((user as any)?.role as UserRole) || "regular";
  const initials =
    (user as any)?.name
      ?.split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase() || "U";

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/user/language", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: preferredLanguage }),
      });
      if (!res.ok) {
        throw new Error("Failed to save");
      }
      queryClient.invalidateQueries({ queryKey: ["session"] });
      toast.success("Language preference saved");
      onOpenChange(false);
    } catch {
      toast.error("Failed to save language preference");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Profile Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Avatar + Info */}
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              <AvatarImage
                src={(user as any)?.image || undefined}
                alt={(user as any)?.name || ""}
              />
              <AvatarFallback className="bg-slate-200">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium">{(user as any)?.name || "User"}</p>
              <p className="text-xs text-muted-foreground">
                {(user as any)?.email}
              </p>
              <div className="mt-1">
                <RoleBadge role={role} />
              </div>
            </div>
          </div>

          <Separator />

          {/* Language Preference */}
          <div className="space-y-2">
            <Label className="text-sm">
              Preferred language for Explainers
            </Label>
            <Select
              value={preferredLanguage}
              onValueChange={setPreferredLanguage}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Default: English. This will be used for all new Explainers.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
