import { PlaceholderPage } from '@/shared/ui/placeholder-page';

/** Login de personal con OTP (se implementa en las historias de E1). */
export function LoginPlaceholder() {
  return (
    <PlaceholderPage
      eyebrow="Acceso de personal"
      title="Iniciar sesión"
      description="El ingreso con código de un solo uso (OTP) para administradores, despachadores y operadores turísticos llegará en el hito M1 Identidad."
    />
  );
}
