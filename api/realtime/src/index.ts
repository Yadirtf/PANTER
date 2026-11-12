import type { Env } from './env';
import { buildHealth } from './modules/health/domain/health';

export { DriverTracker } from './objects/driver-tracker';
export { OpsHub } from './objects/ops-hub';
export { TripRoom } from './objects/trip-room';
export { ZoneIndex } from './objects/zone-index';

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json(buildHealth(env.APP_VERSION, env.GIT_COMMIT));
    }

    if (request.method === 'GET' && url.pathname === '/ws/ops') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Se esperaba Upgrade: websocket', { status: 426 });
      }
      const stub = env.OPS_HUB.get(env.OPS_HUB.idFromName('global'));
      return stub.fetch(request);
    }

    return Response.json({ error: 'not_found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
