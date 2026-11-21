import { Role } from '@panter/contracts';
import Link from 'next/link';
import { PlaceholderPage } from '@/shared/ui/placeholder-page';
import { STAFF_PANEL_LABEL } from '@/features/navigation/role-home';
import { ADMIN_AREAS_PATH } from '@/features/areas/lib/areas';
import { ADMIN_DRIVERS_PATH } from '@/features/drivers/lib/drivers';
import { ADMIN_FARES_PATH } from '@/features/fares/lib/fares';
import { ADMIN_USERS_PATH } from '../lib/users';

const linkClass =
  'inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800';

/**
 * Panel /admin con los enlaces a cada sección. `pendingDrivers` es el número de solicitudes de
 * conductor pendientes ("3", "100+"), o `null` si no se pudo obtener.
 */
export function AdminDashboardPlaceholder({
  pendingDrivers = null,
}: {
  pendingDrivers?: string | null;
}) {
  return (
    <PlaceholderPage
      eyebrow={`Rol ${Role.ADMIN}`}
      title={STAFF_PANEL_LABEL[Role.ADMIN]}
      description="Aquí estarán la flota, la aprobación de conductores, las tarifas y los reportes."
    >
      <nav aria-label="Secciones del panel administrativo">
        <ul className="flex flex-wrap gap-4">
          <li>
            <Link href={ADMIN_USERS_PATH} className={linkClass}>
              Usuarios y roles
            </Link>
          </li>
          <li>
            <Link href={ADMIN_DRIVERS_PATH} className={linkClass}>
              Conductores
              {pendingDrivers && pendingDrivers !== '0' ? (
                <span
                  aria-label={`${pendingDrivers} pendientes`}
                  className="rounded-full bg-amber-300 px-2 py-0.5 text-xs font-bold text-amber-950"
                >
                  {pendingDrivers}
                </span>
              ) : null}
            </Link>
          </li>
          <li>
            <Link href={ADMIN_FARES_PATH} className={linkClass}>
              Tarifas
            </Link>
          </li>
          <li>
            <Link href={ADMIN_AREAS_PATH} className={linkClass}>
              Barrios y veredas
            </Link>
          </li>
        </ul>
      </nav>
    </PlaceholderPage>
  );
}
