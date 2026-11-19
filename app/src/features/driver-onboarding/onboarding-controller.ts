// Estado del onboarding de conductor (HU-203): perfil de GET /drivers/me, envío del vehículo y
// documentos aceptados por la cola de subida. TypeScript puro; React lo consume con
// useSyncExternalStore (ver use-driver-onboarding.ts).
import type { DocumentType, DriverDocument, DriverProfile } from '@panter/contracts';
import { errorMessage } from '../../shared/api/error-messages';
import { toApiError } from '../../shared/api/errors';
import type { DriversApi } from './api/drivers-api';
import {
  type ApplyErrorDisplay,
  applyErrorDisplay,
  type VehicleFormErrors,
  type VehicleFormValues,
  validateVehicleForm,
} from './vehicle/vehicle-form';

export type OnboardingLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface OnboardingState {
  /** `loading` solo en la primera carga; luego los refrescos usan `refreshing`. */
  readonly status: OnboardingLoadStatus;
  /** `null`: aún no ha solicitado ser conductor. */
  readonly profile: DriverProfile | null;
  readonly refreshing: boolean;
  /** Mensaje del último refresco fallido (sin red…); se conserva el último perfil conocido. */
  readonly error: string | null;
}

export type ApplyResult =
  | { readonly outcome: 'applied'; readonly profile: DriverProfile }
  | { readonly outcome: 'invalid'; readonly errors: VehicleFormErrors }
  | { readonly outcome: 'error'; readonly display: ApplyErrorDisplay };

export interface OnboardingControllerDeps {
  api: DriversApi;
  /** Cola de subida: cada documento aceptado se refleja en el perfil sin esperar a GET. */
  uploads?: { onUploaded(listener: (document: DriverDocument) => void): () => void };
  now?: () => Date;
}

const INITIAL: OnboardingState = { status: 'idle', profile: null, refreshing: false, error: null };

type Listener = () => void;

/** Refleja en el perfil un documento recién aceptado por la API (respuesta del PUT). */
export function mergeDocument(profile: DriverProfile, document: DriverDocument): DriverProfile {
  const documents = [...profile.documents.filter((d) => d.type !== document.type), document];
  const stillMissing = document.status === 'REJECTED';
  const missingDocuments: DocumentType[] = stillMissing
    ? profile.missingDocuments
    : profile.missingDocuments.filter((type) => type !== document.type);
  return { ...profile, documents, missingDocuments };
}

export class OnboardingController {
  private readonly api: DriversApi;
  private readonly now: () => Date;
  private state: OnboardingState = INITIAL;
  private readonly listeners = new Set<Listener>();
  /** Descarta respuestas de GET /drivers/me que llegan después de otra más nueva. */
  private seq = 0;
  private inflight: Promise<void> | null = null;

  constructor(deps: OnboardingControllerDeps) {
    this.api = deps.api;
    this.now = deps.now ?? (() => new Date());
    deps.uploads?.onUploaded((document) => this.handleUploaded(document));
  }

  getState = (): OnboardingState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  protected setState(patch: Partial<OnboardingState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Perfil nuevo (de GET, del apply o de un documento subido). Punto de enganche de HU-205. */
  protected applyProfile(profile: DriverProfile | null): void {
    this.setState({ profile, status: 'ready', error: null });
  }

  /** GET /drivers/me. Las llamadas simultáneas comparten la misma petición. */
  refresh(): Promise<void> {
    this.inflight ??= this.doRefresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doRefresh(): Promise<void> {
    const seq = ++this.seq;
    this.setState(
      this.state.status === 'idle' || (this.state.status === 'error' && !this.state.profile)
        ? { status: 'loading', error: null }
        : { refreshing: true },
    );
    try {
      const profile = await this.api.getMe();
      if (seq !== this.seq) return;
      this.applyProfile(profile);
    } catch (error) {
      if (seq !== this.seq) return;
      const message = errorMessage(toApiError(error));
      this.setState(
        this.state.profile || this.state.status === 'ready'
          ? { error: message }
          : { status: 'error', error: message },
      );
    } finally {
      if (seq === this.seq) this.setState({ refreshing: false });
    }
  }

  /**
   * Paso 1: valida y envía POST /drivers/apply. Si ya había solicitud (DRIVER_ALREADY_APPLIED)
   * recarga GET /drivers/me para precargar el formulario con lo registrado.
   */
  async apply(values: VehicleFormValues): Promise<ApplyResult> {
    const validation = validateVehicleForm(values, this.now());
    if (!validation.ok) return { outcome: 'invalid', errors: validation.errors };
    try {
      const profile = await this.api.apply(validation.body);
      this.seq += 1;
      this.applyProfile(profile);
      return { outcome: 'applied', profile };
    } catch (error) {
      const display = applyErrorDisplay(toApiError(error));
      if (display.kind === 'alreadyApplied') await this.refresh();
      return { outcome: 'error', display };
    }
  }

  /** Cierre de sesión: olvida el perfil del usuario anterior. */
  reset(): void {
    this.seq += 1;
    this.inflight = null;
    this.state = INITIAL;
    for (const listener of this.listeners) listener();
  }

  private handleUploaded(document: DriverDocument): void {
    const { profile } = this.state;
    if (profile) {
      this.seq += 1;
      this.applyProfile(mergeDocument(profile, document));
    }
    // Confirma con la API (otro documento pudo cambiar de estado mientras tanto). Un GET que ya
    // estaba en curso salió antes de este documento: se pide otro al terminar.
    const pending = this.inflight ?? Promise.resolve();
    void pending.then(() => this.refresh());
  }
}
