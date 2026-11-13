import type { Metadata } from 'next';
import { LoginForm } from '@/features/auth/components/login-form';
import { safeNextPath } from '@/features/navigation/role-home';

export const metadata: Metadata = { title: 'Iniciar sesión', robots: { index: false } };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  const target = safeNextPath(typeof next === 'string' ? next : null) ?? undefined;
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-16">
      <LoginForm next={target} />
    </main>
  );
}
