import { Role } from '@panter/contracts';
import { StaffPanelPlaceholder } from '@/features/navigation/staff-panel-placeholder';

export function AdminDashboardPlaceholder() {
  return (
    <StaffPanelPlaceholder
      role={Role.ADMIN}
      description="Aquí estarán la flota, la aprobación de conductores, las tarifas y los reportes."
    />
  );
}
