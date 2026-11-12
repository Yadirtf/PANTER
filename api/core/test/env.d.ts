// Tipa `env` y `exports` de `cloudflare:workers` con los bindings de wrangler.jsonc y el
// módulo principal del Worker.
import type { Env as AppEnv } from '../src/env';
import type * as MainModule from '../src/index';

declare global {
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends AppEnv {}
    interface GlobalProps {
      mainModule: typeof MainModule;
    }
  }
}

export {};
