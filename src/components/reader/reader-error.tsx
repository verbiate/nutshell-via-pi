'use client';

import { AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export interface ReaderErrorProps {
  onBack: () => void;
  onRetry: () => void;
}

export function ReaderError({ onBack, onRetry }: ReaderErrorProps) {
  return (
    <div className="absolute inset-0 z-60 flex items-center justify-center bg-background">
      <Card className="mx-4 max-w-sm">
        <CardContent className="flex flex-col items-center gap-4 pt-6">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <h2 className="text-base font-medium">Could not load book</h2>
          <p className="text-center text-sm text-muted-foreground">
            There was a problem opening this book. Try again or return to your
            library.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onBack}>
              Back to Library
            </Button>
            <Button onClick={onRetry}>Try Again</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
