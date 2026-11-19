import type { Metadata } from 'next';
import { DispatchConsole } from '@/features/dispatch/components/dispatch-console';

export const metadata: Metadata = { title: 'Despacho', robots: { index: false } };

export default function DespachoPage() {
  return <DispatchConsole />;
}
