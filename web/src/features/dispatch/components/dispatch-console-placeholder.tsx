import { Role } from '@panter/contracts';
import { StaffPanelPlaceholder } from '@/features/navigation/staff-panel-placeholder';

export function DispatchConsolePlaceholder() {
  return (
    <StaffPanelPlaceholder
      role={Role.DISPATCHER}
      description="Aquí estarán la flota en vivo, la asignación manual de viajes y las alertas SOS."
    />
  );
}
