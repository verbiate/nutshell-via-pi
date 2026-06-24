'use client';

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@teispace/next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SceneTransitionProvider } from "@/components/transitions/scene-transition";
import { AudioProvider } from "@/components/audio/audio-provider";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        themes={["light", "dark", "sepia"]}
        enableSystem={false}
        disableTransitionOnChange={false}
      >
        <TooltipProvider>
          <SceneTransitionProvider>
            <AudioProvider>{children}</AudioProvider>
          </SceneTransitionProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
