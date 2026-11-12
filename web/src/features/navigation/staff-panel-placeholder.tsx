import type { StaffRole } from '@panter/contracts';
import { PlaceholderPage } from '@/shared/ui/placeholder-page';
import { STAFF_PANEL_LABEL } from './role-home';

/** Página provisional común a los paneles de personal. */
export function StaffPanelPlaceholder({
  role,
  description,
}: {
  role: StaffRole;
  description: string;
}) {
  return (
    <PlaceholderPage
      eyebrow={`Rol ${role}`}
      title={STAFF_PANEL_LABEL[role]}
      description={description}
    />
  );
}
