import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

export const metadata: Metadata = { title: 'Solo para personal', robots: { index: false } };
// Se renderiza en cada petición para que el 403 llegue con el HTML completo.
export const dynamic = 'force-dynamic';

/** Destino del rewrite de middleware.ts para sesiones sin roles de personal (403). */
export default function StaffOnlyRoute() {
  forbidden();
}
