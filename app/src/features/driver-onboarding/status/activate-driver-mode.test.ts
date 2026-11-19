import type { ActiveMode, MeResponse } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/errors';
import { makeUser } from '../../../test/fake-api';
import { activateDriverMode, ROLE_MISSING_MESSAGE } from './activate-driver-mode';

function fakeSession(options: { rolesAfterRefresh: MeResponse['roles']; switchError?: Error }) {
  const calls: string[] = [];
  let user = makeUser({ roles: ['PASSENGER'], activeMode: 'driver' });
  return {
    calls,
    session: {
      getState: () => ({
        status: 'signedIn' as const,
        user,
        activeMode: user.activeMode,
        signedOutReason: null,
      }),
      refreshProfile: async () => {
        calls.push('GET /me');
        user = { ...user, roles: options.rolesAfterRefresh };
      },
      switchMode: async (mode: ActiveMode) => {
        calls.push(`POST /me/mode ${mode}`);
        if (options.switchError) throw options.switchError;
      },
    },
  };
}

describe('activateDriverMode', () => {
  it('refresca GET /me para tener DRIVER y luego cambia a modo conductor', async () => {
    const { session, calls } = fakeSession({ rolesAfterRefresh: ['PASSENGER', 'DRIVER'] });
    await expect(activateDriverMode(session)).resolves.toEqual({ outcome: 'switched' });
    expect(calls).toEqual(['GET /me', 'POST /me/mode driver']);
  });

  it('si la sesión aún no trae el rol DRIVER no intenta cambiar de modo', async () => {
    const { session, calls } = fakeSession({ rolesAfterRefresh: ['PASSENGER'] });
    await expect(activateDriverMode(session)).resolves.toEqual({
      outcome: 'roleMissing',
      message: ROLE_MISSING_MESSAGE,
    });
    expect(calls).toEqual(['GET /me']);
  });

  it('muestra el error de POST /me/mode', async () => {
    const { session } = fakeSession({
      rolesAfterRefresh: ['PASSENGER', 'DRIVER'],
      switchError: new ApiError('MODE_CHANGE_ACTIVE_TRIP', 'viaje', 409),
    });
    await expect(activateDriverMode(session)).resolves.toEqual({
      outcome: 'error',
      message: 'Tienes un viaje en curso. Termínalo o cancélalo antes de cambiar de modo.',
    });
  });
});
