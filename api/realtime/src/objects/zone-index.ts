import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

/** Índice de conductores disponibles por celda geohash (HU posteriores). */
export class ZoneIndex extends DurableObject<Env> {}
