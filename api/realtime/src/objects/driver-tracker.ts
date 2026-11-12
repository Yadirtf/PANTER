import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

/** Uno por conductor conectado: recibe GPS y lo reenvía al viaje activo (HU posteriores). */
export class DriverTracker extends DurableObject<Env> {}
