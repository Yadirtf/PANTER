import { LogoutButton } from '@/features/auth/components/logout-button';
import { STAFF_ONLY_MESSAGE } from '@/features/auth/lib/messages';
import { PlaceholderPage } from '@/shared/ui/placeholder-page';

/** 403: la sesión no tiene roles de personal (pasajeros y conductores usan la app). */
export default function StaffOnlyPage() {
  return (
    <PlaceholderPage
      eyebrow="Acceso de personal"
      title={STAFF_ONLY_MESSAGE}
      description="Los pasajeros y conductores piden y atienden viajes desde la app PANTER. Si eres parte del personal, cierra sesión y entra con tu cuenta de personal."
    >
      <div>
        <LogoutButton />
      </div>
    </PlaceholderPage>
  );
}
