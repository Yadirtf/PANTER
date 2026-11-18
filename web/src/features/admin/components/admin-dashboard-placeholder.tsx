import { Role } from '@panter/contracts';
import Link from 'next/link';
import { PlaceholderPage } from '@/shared/ui/placeholder-page';
import { STAFF_PANEL_LABEL } from '@/features/navigation/role-home';
import { ADMIN_USERS_PATH } from '../lib/users';

export function AdminDashboardPlaceholder() {
  return (
    <PlaceholderPage
      eyebrow={`Rol ${Role.ADMIN}`}
      title={STAFF_PANEL_LABEL[Role.ADMIN]}
      description="Aquí estarán la flota, la aprobación de conductores, las tarifas y los reportes."
    >
      <nav aria-label="Secciones del panel administrativo">
        <ul className="flex flex-wrap gap-4">
          <li>
            <Link
              href={ADMIN_USERS_PATH}
              className="inline-block rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800"
            >
              Usuarios y roles
            </Link>
          </li>
        </ul>
      </nav>
    </PlaceholderPage>
  );
}
