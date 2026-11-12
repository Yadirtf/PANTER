import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const BASE = 'https://realtime.test';

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.addEventListener('message', (event) => resolve(String(event.data)), { once: true });
    ws.addEventListener('error', () => reject(new Error('error de WebSocket')), { once: true });
  });
}

async function connectOps(): Promise<WebSocket> {
  const res = await exports.default.fetch(`${BASE}/ws/ops`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error('La respuesta no trae WebSocket');
  ws.accept();
  return ws;
}

describe('GET /health', () => {
  it('responde el contrato que consume api-core', async () => {
    const res = await exports.default.fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      service: 'panter-realtime',
      version: 'dev',
      commit: 'dev',
    });
  });
});

describe('rutas', () => {
  it('devuelve 404 en rutas desconocidas', async () => {
    const res = await exports.default.fetch(`${BASE}/nada`);
    expect(res.status).toBe(404);
  });

  it('exige Upgrade: websocket en /ws/ops', async () => {
    const res = await exports.default.fetch(`${BASE}/ws/ops`);
    expect(res.status).toBe(426);
  });
});

describe('OpsHub (WebSocket Hibernation API)', () => {
  it('hace eco del mensaje enviado', async () => {
    const ws = await connectOps();
    const reply = nextMessage(ws);
    ws.send('hola despacho');
    expect(JSON.parse(await reply)).toEqual({ type: 'echo', data: 'hola despacho' });
    ws.close(1000, 'fin');
  });

  it('difunde el mensaje a todos los clientes conectados', async () => {
    const a = await connectOps();
    const b = await connectOps();
    const toA = nextMessage(a);
    const toB = nextMessage(b);
    a.send('alerta');
    expect(JSON.parse(await toA)).toEqual({ type: 'echo', data: 'alerta' });
    expect(JSON.parse(await toB)).toEqual({ type: 'echo', data: 'alerta' });
    a.close(1000, 'fin');
    b.close(1000, 'fin');
  });

  it('responde ping con pong automáticamente', async () => {
    const ws = await connectOps();
    const reply = nextMessage(ws);
    ws.send('ping');
    expect(await reply).toBe('pong');
    ws.close(1000, 'fin');
  });
});

describe('Durable Objects registrados', () => {
  it('expone los cuatro namespaces', () => {
    expect(env.DRIVER_TRACKER).toBeDefined();
    expect(env.ZONE_INDEX).toBeDefined();
    expect(env.TRIP_ROOM).toBeDefined();
    expect(env.OPS_HUB).toBeDefined();
  });
});
