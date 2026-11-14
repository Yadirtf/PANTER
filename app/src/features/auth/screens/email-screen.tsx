// Pantalla 1 del login: el usuario escribe su correo y pide el código (POST /auth/otp/request).
import { EmailSchema } from '@panter/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { errorMessage } from '../../../shared/api/error-messages';
import { toApiError } from '../../../shared/api/errors';
import { Button, ErrorMessage, Field } from '../../../shared/ui/form';
import { authApi } from '../session/instance';
import { useSession } from '../session/session-context';
import { resendWaitSeconds, toRouteParams } from '../otp/code-params';
import { AuthLayout } from './auth-layout';

export function EmailScreen() {
  const router = useRouter();
  const { signedOutReason } = useSession();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notice = signedOutReason ? errorMessage({ code: signedOutReason }) : null;

  async function submit() {
    const parsed = EmailSchema.safeParse(email);
    if (!parsed.success) {
      setError('Escribe un correo válido, por ejemplo nombre@gmail.com.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const response = await authApi.requestOtp({ email: parsed.data });
      router.push({
        pathname: '/code',
        params: toRouteParams({
          email: parsed.data,
          sentAt: Date.now(),
          resendAfter: resendWaitSeconds(response.resendAfterSeconds),
        }),
      });
    } catch (err) {
      setError(errorMessage(toApiError(err)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Ingresa con tu correo"
      subtitle="Te enviaremos un código de 6 dígitos. No necesitas contraseña."
    >
      <ErrorMessage>{error ?? notice}</ErrorMessage>
      <Field
        value={email}
        onChangeText={setEmail}
        placeholder="tucorreo@gmail.com"
        accessibilityLabel="Correo electrónico"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={submit}
        editable={!loading}
      />
      <Button title="Enviar código" onPress={submit} loading={loading} />
    </AuthLayout>
  );
}
