'use client';

import { useEffect, useState } from 'react';
import { useTheme } from '@teispace/next-themes';
import { Sun, Moon, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  const cycleTheme = () => {
    if (resolvedTheme === 'light') {
      setTheme('sepia');
    } else if (resolvedTheme === 'sepia') {
      setTheme('dark');
    } else {
      setTheme('light');
    }
  };

  if (!mounted) {
    // Placeholder with same dimensions as icon-sm button to prevent layout shift
    return <div className="h-7 w-7" />;
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={cycleTheme}
      aria-label="Cycle theme (light, sepia, dark)"
    >
      {resolvedTheme === 'light' && <Sun className="h-4 w-4" />}
      {resolvedTheme === 'sepia' && <BookOpen className="h-4 w-4" />}
      {resolvedTheme === 'dark' && <Moon className="h-4 w-4" />}
    </Button>
  );
}
