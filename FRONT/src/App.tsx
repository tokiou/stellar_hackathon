'use client';

import { Toaster } from '@/components/ui/toaster';
import { AppShell } from './components/layout/AppShell';
import { PhantomProvider } from './providers/PhantomProvider';
import { QueryProvider } from './providers/QueryProvider';
import { ThemeProvider } from './providers/ThemeProvider';

export default function App() {
  return (
    <QueryProvider>
      <PhantomProvider>
        <ThemeProvider>
          <AppShell />
          <Toaster />
        </ThemeProvider>
      </PhantomProvider>
    </QueryProvider>
  );
}
