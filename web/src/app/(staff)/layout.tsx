import type { ReactNode } from 'react';
import { readSessionClaims } from '@/features/auth/server/current-session';
import { StaffHeader } from '@/features/navigation/staff-header';

/** Paneles de personal (/admin, /despacho, /operador). middleware.ts exige sesión y rol. */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const claims = await readSessionClaims();
  return (
    <>
      <StaffHeader roles={claims?.roles ?? []} />
      {children}
    </>
  );
}
