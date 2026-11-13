// Pantalla 2 del login: código de 6 dígitos (POST /auth/otp/verify) con reenvío tras 60 s.
import { ApiErrorCode, OTP_LENGTH } from '@panter/contracts';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { errorMessage } from '../../../shared/api/error-messages';
import { toApiError } from '../../../shared/api/errors';
import { Button, ErrorMessage, Field, colors } from '../../../shared/ui/form';
import { authApi } from '../session/instance';
import { useSession } from '../session/session-context';
import { parseRouteParams, resendWaitSeconds } from '../otp/code-params';
import { formatCountdown, sanitizeCodeInput } from '../otp/resend-timer';
import { useResendCountdown } from '../otp/use-resend-countdown';
import { AuthLayout } from './auth-layout';

/** Errores tras los que el código ya no sirve y hay que pedir otro. */
const CODE_DEAD = new Set<string>([ApiErrorCode.OTP_EXPIRED, ApiErrorCode.OTP_TOO_MANY_ATTEMPTS]);

export function CodeScreen() {
  const rawParams = useLocalSearchParams();
  const params = useMemo(() => parseRouteParams(rawParams, Date.now()), [rawParams]);
  if (!params) return <Redirect href="/" />;
  return <CodeForm email={params.email} initialSentAt={params.sentAt} wait={params.resendAfter} />;
}

function CodeForm({
  email,
  initialSentAt,
  wait: initialWait,
}: {
  email: string;
  initialSentAt: number;
  wait: number;
}) {
  const router = useRouter();
  const { manager } = useSession();
  const [code, setCode] = useState('');
  const [sentAt, setSentAt] = useState(initialSentAt);
  const [wait, setWait] = useState(initialWait);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const remaining = useResendCountdown(sentAt, wait);

  async function verify(value: string) {
    if (value.length !== OTP_LENGTH || verifying) return;
    setError(null);
    setInfo(null);
    setVerifying(true);
    try {
      const pair = await authApi.verifyOtp({ email, code: value });
      // El layout raíz detecta la sesión y lleva a la pantalla que corresponde.
      await manager.signIn(pair);
    } catch (err) {
      const apiError = toApiError(err);
      setError(errorMessage(apiError));
      if (CODE_DEAD.has(apiError.code) || apiError.code === ApiErrorCode.OTP_INVALID) setCode('');
      setVerifying(false);
    }
  }

  async function resend() {
    setError(null);
    setInfo(null);
    setResending(true);
    try {
      const response = await authApi.requestOtp({ email });
      setSentAt(Date.now());
      setWait(resendWaitSeconds(response.resendAfterSeconds));
      setCode('');
      setInfo('Te enviamos un código nuevo. Revisa también la carpeta de spam o Promociones.');
    } catch (err) {
      setError(errorMessage(toApiError(err)));
    } finally {
      setResending(false);
    }
  }

  function onChange(text: string) {
    const next = sanitizeCodeInput(text, OTP_LENGTH);
    setCode(next);
    if (next.length === OTP_LENGTH) void verify(next);
  }

  return (
    <AuthLayout
      title="Escribe el código"
      subtitle={
        <>
          Lo enviamos a <Text style={styles.email}>{email}</Text>. Vence en 5 minutos.
        </>
      }
    >
      <ErrorMessage>{error}</ErrorMessage>
      {info ? <Text style={styles.info}>{info}</Text> : null}
      <Field
        value={code}
        onChangeText={onChange}
        placeholder="123456"
        accessibilityLabel={`Código de ${OTP_LENGTH} dígitos`}
        keyboardType="number-pad"
        maxLength={OTP_LENGTH}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        autoFocus
        editable={!verifying}
      />
      <Button
        title="Ingresar"
        onPress={() => void verify(code)}
        disabled={code.length !== OTP_LENGTH}
        loading={verifying}
      />
      <Button
        variant="secondary"
        title={
          remaining > 0 ? `Reenviar código en ${formatCountdown(remaining)}` : 'Reenviar código'
        }
        onPress={() => void resend()}
        disabled={remaining > 0 || verifying}
        loading={resending}
      />
      <Text accessibilityRole="link" style={styles.link} onPress={() => router.back()}>
        Cambiar correo
      </Text>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  email: { fontWeight: '700', color: colors.text },
  info: { color: colors.primary, fontSize: 15 },
  link: { color: colors.primary, fontSize: 16, textAlign: 'center', padding: 8 },
});
