import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from '@/features/auth/components/login-form';
import { PRIVACY_PATH, safeNextPath } from '@/features/navigation/role-home';

export const metadata: Metadata = { title: 'Iniciar sesión', robots: { index: false } };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  const target = safeNextPath(typeof next === 'string' ? next : null) ?? undefined;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-16">
      <LoginForm next={target} />
      <Link href={PRIVACY_PATH} className="text-sm font-medium text-emerald-800 hover:underline">
        Aviso de privacidad
      </Link>
    </main>
  );
}
