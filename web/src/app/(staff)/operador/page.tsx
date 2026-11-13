import type { Metadata } from 'next';
import { OperatorPanelPlaceholder } from '@/features/operator/components/operator-panel-placeholder';

export const metadata: Metadata = { title: 'Operador turístico', robots: { index: false } };

export default function OperadorPage() {
  return <OperatorPanelPlaceholder />;
}
