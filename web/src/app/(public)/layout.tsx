import Link from 'next/link';
import type { ReactNode } from 'react';

/** Portal turístico público: no requiere sesión. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="border-b border-stone-200 bg-white">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-xl font-bold text-emerald-800">
            PANTER
          </Link>
        </nav>
      </header>
      {children}
    </>
  );
}
