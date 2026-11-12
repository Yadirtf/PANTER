import type { Metadata } from 'next';
import { LoginPlaceholder } from '@/features/auth/components/login-placeholder';

export const metadata: Metadata = { title: 'Iniciar sesión' };

export default function LoginPage() {
  return <LoginPlaceholder />;
}
