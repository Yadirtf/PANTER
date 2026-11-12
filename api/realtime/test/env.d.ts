// Tipa `env` y `exports` de cloudflare:workers dentro de las pruebas.
import type { Env as RealtimeEnv } from '../src/env';
import type * as MainModule from '../src/index';

declare global {
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends RealtimeEnv {}
    interface GlobalProps {
      mainModule: typeof MainModule;
      durableNamespaces: 'DriverTracker' | 'ZoneIndex' | 'TripRoom' | 'OpsHub';
    }
  }
}
