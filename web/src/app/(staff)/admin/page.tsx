import type { Metadata } from 'next';
import { AdminDashboardPlaceholder } from '@/features/admin/components/admin-dashboard-placeholder';

export const metadata: Metadata = { title: 'Administración', robots: { index: false } };

export default function AdminPage() {
  return <AdminDashboardPlaceholder />;
}
