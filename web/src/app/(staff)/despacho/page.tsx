import type { Metadata } from 'next';
import { catalogApi } from '@/features/catalog/server/deps';
import { loadPublicPlaces } from '@/features/catalog/server/load-catalog';
import { DispatchConsole } from '@/features/dispatch/components/dispatch-console';

export const metadata: Metadata = { title: 'Despacho', robots: { index: false } };

/** /despacho: los lugares salen del catálogo (GET /places, público), leídos en el servidor. */
export default async function DespachoPage() {
  const places = await loadPublicPlaces(catalogApi);
  return <DispatchConsole places={places} />;
}
