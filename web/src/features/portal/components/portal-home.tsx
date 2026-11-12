import Link from 'next/link';
import { ApiStatus } from '@/features/health';
import { LOGIN_PATH } from '@/features/navigation/role-home';
import { PlaceholderPage } from '@/shared/ui/placeholder-page';

/** Portada provisional del portal turístico público (con SEO, sin sesión). */
export function PortalHome() {
  return (
    <PlaceholderPage
      eyebrow="Villagarzón · Putumayo"
      title="Movilidad y ecoturismo en la puerta de la Amazonía"
      description="Muy pronto podrás conocer los circuitos turísticos de Villagarzón, reservar cupos con operadores locales y pedir tu viaje desde la app PANTER."
    >
      <div className="flex flex-wrap items-center gap-4">
        <Link
          href={LOGIN_PATH}
          className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800"
        >
          Acceso para personal
        </Link>
        <ApiStatus />
      </div>
    </PlaceholderPage>
  );
}
