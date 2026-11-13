import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

export const metadata: Metadata = { title: 'Acceso no permitido', robots: { index: false } };

/**
 * Destino del rewrite de middleware.ts cuando el rol no corresponde al panel. `forbidden()`
 * responde 403 y muestra forbidden.tsx: el status de un rewrite no se conserva al renderizar.
 */
export default function ForbiddenRoute() {
  forbidden();
}
