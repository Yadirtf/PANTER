# PANTER

Plataforma de movilidad y ecoturismo de Villagarzón (Putumayo).

- Especificación: [`Docs/ESPECIFICACION.md`](Docs/ESPECIFICACION.md)
- Backlog: [`Docs/BACKLOG.md`](Docs/BACKLOG.md) (cargado como issues con `scripts/crear_issues.sh`)
- Decisiones de arquitectura: [`Docs/adr/`](Docs/adr/)

## Estructura

| Carpeta              | Contenido                                           |
| -------------------- | --------------------------------------------------- |
| `api/core`           | Worker `panter-api` (Hono, REST)                    |
| `api/realtime`       | Worker `panter-realtime` (Durable Objects)          |
| `web`                | Worker `panter-web` (Next.js + OpenNext)            |
| `app`                | App móvil Expo (React Native + MapLibre)            |
| `packages/contracts` | Esquemas Zod, tipos, enums y constantes compartidas |
| `Docs`               | Especificación, backlog y ADR                       |

Ninguna app importa código de otra; solo `@panter/contracts` se comparte. Dentro de cada
módulo del backend se sigue Clean Architecture ([ADR 0001](Docs/adr/0001-clean-architecture-por-modulo.md)).

## Requisitos

- Node.js 20+ (CI usa la versión de `.nvmrc`)
- pnpm 10 (`corepack enable` toma la versión de `packageManager`)

## Comandos

```bash
pnpm install          # instala todo el monorepo
pnpm lint             # ESLint (incluye reglas de fronteras de arquitectura)
pnpm format           # Prettier (escribe)
pnpm format:check     # Prettier (verifica)
pnpm typecheck        # tsc --noEmit en cada paquete
pnpm test             # Vitest en cada paquete
pnpm check            # todo lo anterior, igual que el CI
```

Para un solo paquete: `pnpm --filter @panter/contracts test`.

## Flujo de trabajo

- Ramas: `main` (producción), `develop` (staging), `feature/<issue>-<slug>`, `hotfix/*`.
- PR hacia `develop` con `Closes #<issue>`; el CI debe pasar.
- Commits con Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`).
