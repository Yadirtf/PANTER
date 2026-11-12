import type { DriverTracker } from './objects/driver-tracker';
import type { OpsHub } from './objects/ops-hub';
import type { TripRoom } from './objects/trip-room';
import type { ZoneIndex } from './objects/zone-index';

/** Bindings del Worker panter-realtime (ver wrangler.jsonc). */
export interface Env {
  APP_VERSION?: string;
  GIT_COMMIT?: string;
  DRIVER_TRACKER: DurableObjectNamespace<DriverTracker>;
  ZONE_INDEX: DurableObjectNamespace<ZoneIndex>;
  TRIP_ROOM: DurableObjectNamespace<TripRoom>;
  OPS_HUB: DurableObjectNamespace<OpsHub>;
}
