import * as React from "react"
import { MoreHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ponytail: the single source of truth for the three-dot overflow trigger
// shared by the Discussions, Bookmarks, Highlights, Notes, and ToC rows. One
// treatment so they cannot drift: ghost, 32px bordered circle, MoreHorizontal
// icon. Hover-revealed at md+ (visible on touch widths where hover is absent),
// revealed on row hover OR keyboard focus-within. The nearest row ancestor
// must carry the `group` class.
function OverflowMenuTrigger({
  label,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button
      variant="ghost"
      aria-label={label}
      className={cn(
        "h-8 w-8 shrink-0 rounded-full border border-line",
        "opacity-100 transition-opacity hover:bg-accent md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
        className,
      )}
      {...props}
    >
      <MoreHorizontal className="h-4 w-4" />
    </Button>
  )
}

export { OverflowMenuTrigger }
