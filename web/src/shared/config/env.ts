import { z } from 'zod';

const DEFAULT_API_URL = 'http://localhost:8787';

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url().default(DEFAULT_API_URL),
  NEXT_PUBLIC_APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
});
export type PublicEnv = z.infer<typeof PublicEnvSchema>;

/**
 * Variables públicas por entorno. Next.js las incrusta en el build, por eso se leen
 * con acceso literal (`process.env.NEXT_PUBLIC_*`) y no recorriendo `process.env`.
 */
export const publicEnv: PublicEnv = PublicEnvSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || undefined,
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV || undefined,
});
