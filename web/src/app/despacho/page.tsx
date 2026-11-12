import type { Metadata } from 'next';
import { DispatchConsolePlaceholder } from '@/features/dispatch/components/dispatch-console-placeholder';

export const metadata: Metadata = { title: 'Despacho', robots: { index: false } };

export default function DespachoPage() {
  return <DispatchConsolePlaceholder />;
}
