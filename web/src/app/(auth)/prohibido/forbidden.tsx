import Link from 'next/link';
import { LogoutButton } from '@/features/auth/components/logout-button';
import { readSessionClaims } from '@/features/auth/server/current-session';
import { homeForRoles } from '@/features/navigation/role-home';
import { PlaceholderPage } from '@/shared/ui/placeholder-page';

/** 403: la sesión es de personal pero su rol no puede entrar a este panel (middleware.ts). */
export default async function ForbiddenPage() {
  const claims = await readSessionClaims();
  const home = claims ? homeForRoles(claims.roles) : null;
  return (
    <PlaceholderPage
      eyebrow="Error 403"
      title="No tienes permiso para ver esta página"
      description="Tu rol no tiene acceso a este panel. Si crees que es un error, pide al administrador de PANTER que revise tus permisos."
    >
      <div className="flex flex-wrap items-center gap-4">
        {home ? (
          <Link
            href={home}
            className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800"
          >
            Ir a mi panel
          </Link>
        ) : null}
        <LogoutButton />
      </div>
    </PlaceholderPage>
  );
}
