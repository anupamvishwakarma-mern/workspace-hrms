'use client';
import { Button } from '@/components/ui/button';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center px-4 py-24 text-center">
      <h1 className="text-3xl font-bold">Something went wrong</h1>
      <p className="mt-3 text-muted">Please try again. If it keeps happening, contact us.</p>
      <Button className="mt-8" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
