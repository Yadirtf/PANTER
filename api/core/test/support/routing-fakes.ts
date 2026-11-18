// Dobles en memoria de los puertos del módulo routing (HU-305).
import type {
  ProviderRequestLog,
  ProviderUsageCounter,
  RouteCache,
  RouteProvider,
  RouteRateStore,
  RouteRequest,
  RoutingLog,
} from '../../src/modules/routing/application/ports';
import type { RateWindow, Route } from '../../src/modules/routing/domain/route';

/** Ruta centro de Villagarzón → aeropuerto VGZ (la del fixture de ORS). */
export const CENTRO_VGZ_ROUTE: Route = {
  distanceMeters: 5876.4,
  durationSeconds: 548.9,
  polyline:
    'mahE~csrMrBLlE^jEb@bFXvIZtJ]fM{AxPaClRgC~SeC|UuCnV}CzVqDhWwD`VeE~TsErRaFjO_FhJqD~EaBrBi@',
  bbox: [-76.61716, 0.97893, -76.60531, 1.02951],
};

export class FakeRouteProvider implements RouteProvider {
  readonly calls: RouteRequest[] = [];
  constructor(private readonly respond: (req: RouteRequest) => Promise<Route> | Route) {}
  async route(req: RouteRequest): Promise<Route> {
    this.calls.push(req);
    return this.respond(req);
  }
}

export class MemoryRouteCache implements RouteCache {
  readonly entries = new Map<string, Route>();
  async get(key: string) {
    return this.entries.get(key) ?? null;
  }
  async put(key: string, route: Route) {
    this.entries.set(key, route);
  }
}

export class MemoryUsageCounter implements ProviderUsageCounter {
  readonly days = new Map<string, number>();
  async increment(date: string) {
    const next = (this.days.get(date) ?? 0) + 1;
    this.days.set(date, next);
    return next;
  }
}

export class MemoryRateStore implements RouteRateStore {
  readonly windows = new Map<string, RateWindow>();
  async get(userId: string) {
    return this.windows.get(userId) ?? null;
  }
  async put(userId: string, window: RateWindow) {
    this.windows.set(userId, window);
  }
}

export class RecordingRoutingLog implements RoutingLog {
  readonly requests: ProviderRequestLog[] = [];
  readonly warnings: { date: string; count: number; quota: number }[] = [];
  readonly notConfiguredMessages: string[] = [];
  readonly storageErrors: string[] = [];
  providerRequest(entry: ProviderRequestLog) {
    this.requests.push(entry);
  }
  quotaWarning(entry: { date: string; count: number; quota: number }) {
    this.warnings.push(entry);
  }
  notConfigured(message: string) {
    this.notConfiguredMessages.push(message);
  }
  storageError(operation: string) {
    this.storageErrors.push(operation);
  }
}
