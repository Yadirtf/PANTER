import type { Role } from '@panter/contracts';
import Link from 'next/link';
import { LogoutButton } from '@/features/auth/components/logout-button';
import { accessiblePanels, STAFF_HOME, STAFF_PANEL_LABEL } from './role-home';

/** Encabezado de los paneles de personal: paneles a los que el rol puede entrar y "Cerrar sesión". */
export function StaffHeader({ roles }: { roles: readonly Role[] }) {
  const panels = accessiblePanels(roles);
  return (
    <header className="border-b border-stone-200 bg-white">
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div className="flex flex-wrap items-center gap-6">
          <Link href="/" className="text-xl font-bold text-emerald-800">
            PANTER
          </Link>
          {panels.length > 1 ? (
            <ul className="flex flex-wrap gap-4 text-sm font-medium text-stone-600">
              {panels.map((panel) => (
                <li key={panel}>
                  <Link href={STAFF_HOME[panel]} className="hover:text-emerald-800">
                    {STAFF_PANEL_LABEL[panel]}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <LogoutButton />
      </nav>
    </header>
  );
}
