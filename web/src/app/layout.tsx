import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/shared/providers/query-provider';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'PANTER · Movilidad y ecoturismo en Villagarzón',
    template: '%s · PANTER',
  },
  description: 'Movilidad y ecoturismo en Villagarzón, Putumayo.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
