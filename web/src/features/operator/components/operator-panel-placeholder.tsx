import { Role } from '@panter/contracts';
import { StaffPanelPlaceholder } from '@/features/navigation/staff-panel-placeholder';

export function OperatorPanelPlaceholder() {
  return (
    <StaffPanelPlaceholder
      role={Role.TOUR_OPERATOR}
      description="Aquí estarán los circuitos turísticos, los cupos, los guías y las reservas."
    />
  );
}
