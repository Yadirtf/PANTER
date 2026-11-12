import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Configuración mínima: sin caché incremental en R2 por ahora (no hay ISR en la Fase 1).
export default defineCloudflareConfig({});
