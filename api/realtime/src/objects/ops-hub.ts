import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { echoMessage, PING, PONG } from '../modules/ops/domain/echo';

/**
 * Canal de la consola web (flota en vivo y alertas SOS).
 * Por ahora es un ejemplo de eco/broadcast con la WebSocket Hibernation API.
 */
export class OpsHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // El runtime responde "ping" con "pong" sin despertar al objeto.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Se esperaba Upgrade: websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    // acceptWebSocket (no ws.accept()) permite hibernar con conexiones abiertas.
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const payload = echoMessage(message);
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(payload);
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }
}
