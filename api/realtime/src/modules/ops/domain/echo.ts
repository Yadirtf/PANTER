/** Ping/pong que el runtime responde sin despertar al Durable Object. */
export const PING = 'ping';
export const PONG = 'pong';

/** Mensaje de eco que OpsHub difunde a todos los clientes conectados. */
export function echoMessage(message: string | ArrayBuffer): string {
  const data = typeof message === 'string' ? message : new TextDecoder().decode(message);
  return JSON.stringify({ type: 'echo', data });
}
