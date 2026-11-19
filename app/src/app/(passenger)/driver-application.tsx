import { DriverOnboardingScreen } from '../../features/driver-onboarding/screens/driver-onboarding-screen';

// "Quiero ser conductor" desde el modo pasajero (HU-203).
export default function DriverApplicationScreen() {
  return <DriverOnboardingScreen entry="passenger" />;
}
