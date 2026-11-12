import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

/** Uno por viaje: matching, máquina de estados y sala WebSocket (HU posteriores). */
export class TripRoom extends DurableObject<Env> {}
