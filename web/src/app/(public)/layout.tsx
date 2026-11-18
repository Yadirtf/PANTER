import Link from 'next/link';
import type { ReactNode } from 'react';
import { PRIVACY_PATH } from '@/features/navigation/role-home';

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
      <footer className="border-t border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-sm text-stone-600">
          <p>PANTER · Villagarzón, Putumayo</p>
          <Link href={PRIVACY_PATH} className="font-medium text-emerald-800 hover:underline">
            Aviso de privacidad
          </Link>
        </div>
      </footer>
    </>
  );
}
