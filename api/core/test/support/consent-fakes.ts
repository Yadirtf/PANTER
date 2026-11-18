// Doble en memoria del puerto ConsentRepository (HU-109).
import type {
  AcceptConsentRecord,
  ConsentRepository,
} from '../../src/modules/consent/application/ports';
import { makeGetConsentStatus } from '../../src/modules/consent/application/consent';
import type { ConsentRecord } from '../../src/modules/consent/domain/consent';

export class MemoryConsentRepository implements ConsentRepository {
  readonly accepted: (AcceptConsentRecord & { acceptedAt: string })[] = [];
  /** Cuentas que existen; vacío = todas existen. */
  readonly knownUsers = new Set<string>();
  private tick = 0;

  async latest(userId: string): Promise<ConsentRecord | null> {
    const rows = this.accepted.filter((r) => r.userId === userId);
    const last = rows.at(-1);
    return last ? { version: last.version, acceptedAt: last.acceptedAt } : null;
  }

  async accept(record: AcceptConsentRecord) {
    if (this.knownUsers.size > 0 && !this.knownUsers.has(record.userId)) return false;
    const exists = this.accepted.some(
      (r) => r.userId === record.userId && r.version === record.version,
    );
    if (!exists) {
      this.tick++;
      this.accepted.push({
        ...record,
        acceptedAt: new Date(Date.UTC(2026, 10, 18, 12, 0, this.tick)).toISOString(),
      });
    }
    return true;
  }
}

/** Repositorio en memoria y el lector de estado para `buildAuthFactories({ consent })`. */
export function memoryConsent() {
  const repo = new MemoryConsentRepository();
  return { repo, reader: () => makeGetConsentStatus({ repo }) };
}
