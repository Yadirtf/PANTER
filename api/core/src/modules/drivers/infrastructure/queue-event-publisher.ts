import { DomainEventSchema } from '@panter/contracts';
import type { EventPublisher } from '../application/ports';

/**
 * Publica eventos de dominio en la cola EVENTS (binding de wrangler.jsonc). El cuerpo se valida
 * contra el esquema de @panter/contracts antes de enviarlo: un consumidor nunca recibe un evento
 * que no cumpla el contrato.
 */
export function createQueueEventPublisher(queue: Queue): EventPublisher {
  return {
    async publish(event) {
      await queue.send(DomainEventSchema.parse(event), { contentType: 'json' });
    },
  };
}
