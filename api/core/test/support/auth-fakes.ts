// Dobles en memoria de los puertos de auth. Sin Workers, KV ni base de datos.
import { Role, type UserStatus } from '@panter/contracts';
import type {
  OtpHasher,
  OtpRecord,
  OtpRequestWindow,
  OtpStore,
  UserRepository,
} from '../../src/modules/auth/application/ports';
import type { User } from '../../src/modules/auth/domain/user';

export class MemoryOtpStore implements OtpStore {
  readonly codes = new Map<string, OtpRecord>();
  readonly windows = new Map<string, OtpRequestWindow>();
  async getCode(key: string) {
    return this.codes.get(key) ?? null;
  }
  async putCode(key: string, record: OtpRecord) {
    this.codes.set(key, { ...record });
  }
  async deleteCode(key: string) {
    this.codes.delete(key);
  }
  async getRequestWindow(key: string) {
    return this.windows.get(key) ?? null;
  }
  async putRequestWindow(key: string, window: OtpRequestWindow) {
    this.windows.set(key, { ...window });
  }
}

/** HMAC simulado y determinista (legible en las aserciones). */
export const fakeHasher: OtpHasher = { hmac: async (value) => `h(${value})` };

export class MemoryUserRepository implements UserRepository {
  readonly users = new Map<string, User>();
  created = 0;
  private seq = 0;

  add(email: string, status: UserStatus = 'ACTIVE', roles: Role[] = [Role.PASSENGER]): User {
    const user: User = {
      id: this.nextId(),
      email,
      fullName: null,
      phone: null,
      status,
      roles,
    };
    this.users.set(user.id, user);
    return user;
  }

  async findOrCreatePassenger(email: string) {
    const found = [...this.users.values()].find((u) => u.email.toLowerCase() === email);
    if (found) return found;
    this.created++;
    return this.add(email);
  }

  async findById(id: string) {
    return this.users.get(id) ?? null;
  }

  private nextId() {
    this.seq++;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`;
  }
}

/** Reloj manual. */
export function manualClock(start = Date.UTC(2026, 10, 13, 12, 0, 0)) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

/** Entrega simulada: guarda el último código por correo. */
export function captureDelivery() {
  const sent: { email: string; code: string }[] = [];
  return {
    sent,
    deliver: async (email: string, code: string) => {
      sent.push({ email, code });
    },
    lastCode(email: string) {
      return [...sent].reverse().find((s) => s.email === email)?.code;
    },
  };
}
