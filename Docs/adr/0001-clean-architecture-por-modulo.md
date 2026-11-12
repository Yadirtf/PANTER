# ADR 0001 · Clean Architecture por módulo dentro de un monolito modular

- Estado: aceptada
- Fecha: 2026-11-12
- Relacionado: Especificación v1.1, secciones 2.1 y 3

## Contexto

La especificación v1.1 define la arquitectura macro: un monolito modular repartido en dos
Workers (`api-core` y `api-realtime`), Durable Objects, Queues, KV, R2 y Neon. Falta definir
cómo se organiza el código dentro de cada módulo para que sea fácil de probar, de mantener y
de extraer a otro Worker más adelante, con un solo desarrollador.

## Decisión

### Backend (`api/core`, `api/realtime`)

Cada módulo de negocio (auth, drivers, pricing, trips, wallet, safety, tourism…) sigue Clean
Architecture con cuatro capas. Las dependencias solo apuntan hacia adentro:

```
modules/<modulo>/
├── domain/          Entidades, objetos de valor y reglas puras. Sin Hono, Drizzle ni bindings.
├── application/     Casos de uso y puertos (interfaces de repositorios y servicios externos).
├── infrastructure/  Adaptadores: Drizzle/Neon, KV, R2, Queues, Brevo/Resend, OpenRouteService.
└── http/            Rutas Hono y esquemas Zod de entrada/salida. Sin lógica de negocio.
```

`http → application → domain` e `infrastructure → application → domain`. El dominio no
conoce a nadie.

- **Raíz de composición:** `composition/` arma los casos de uso con sus adaptadores a partir
  de `env` en cada request. Inyección de dependencias manual, sin contenedores (tamaño de
  bundle y arranque en frío en Workers).
- **Durable Objects:** son puntos de entrada, como las rutas HTTP. La lógica (siguiente
  candidato del matching, transiciones de estado) vive en funciones puras de dominio.
- **Rigor proporcional:** módulos críticos (pricing, trips, wallet, auth/RBAC) usan las cuatro
  capas completas. Módulos tipo CRUD (listados, reportes CSV) pueden ser delgados
  (`http → caso de uso → repositorio`) sin entidades elaboradas.
- **Tipos de Drizzle** solo en `infrastructure`; el dominio usa tipos propios simples.
- **Seguridad en profundidad:** Zod valida en `http`; `requireRole()`/`requireMode()` en
  middleware; los casos de uso críticos reciben el actor y validan de nuevo.

### `packages/contracts`

Núcleo compartido y puro: enums, esquemas Zod, máquina de estados del viaje, utilidades
geográficas y tipos de eventos. No depende de ningún framework.

### Web (`web`) y app (`app`)

Organización por funcionalidad (`features/<nombre>/`) con capas ligeras: componentes de UI,
hooks de datos (TanStack Query), cliente HTTP tipado y tipos de `@panter/contracts`. No se
aplica Clean Architecture completa en el frontend.

## Cumplimiento

`eslint.config.js` aplica `no-restricted-imports` por capa: `domain` no puede importar de
`application`, `infrastructure`, `http` ni librerías de infraestructura (Hono, Drizzle, Neon,
`cloudflare:*`, jose); `application` no puede importar adaptadores ni HTTP; `contracts` no
puede importar frameworks. El CI falla si se viola una frontera.

## Consecuencias

- El dominio se prueba con Vitest sin runtime de Workers ni base de datos; la cobertura de
  80 % en módulos críticos es alcanzable.
- Cambiar un proveedor (Brevo → Resend, ORS → otro) solo toca un adaptador.
- Extraer un módulo a su propio Worker es mover la carpeta y exponer su capa `http`.
- Costo: más archivos e interfaces por módulo; se acota con el rigor proporcional.
