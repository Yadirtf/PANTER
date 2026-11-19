import { DriverOnboardingScreen } from '../../features/driver-onboarding/screens/driver-onboarding-screen';

// Modo conductor sin rol DRIVER (aún sin aprobar): registro de conductor (HU-203).
export default function OnboardingScreen() {
  return <DriverOnboardingScreen entry="driverMode" />;
}
