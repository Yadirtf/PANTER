# @panter/api-core

Worker `panter-api` (Hono, REST). Organización por módulo con Clean Architecture
([ADR 0001](../../Docs/adr/0001-clean-architecture-por-modulo.md)).

## Base de datos (Neon + PostGIS + Drizzle)

| Pieza                  | Ubicación                                                                   |
| ---------------------- | --------------------------------------------------------------------------- |
| Esquema Drizzle        | `src/shared/infrastructure/db/schema/`                                      |
| Cliente para Workers   | `src/shared/infrastructure/db/client.ts` (`drizzle-orm/neon-http`)          |
| Tipo `geography`       | `src/shared/infrastructure/db/geography.ts`                                 |
| Migraciones SQL        | `drizzle/` (`0000_enable_postgis.sql`, `0001_users_and_roles.sql`, …)       |
| Aplicar migraciones    | `scripts/migrate.ts` (`drizzle-orm/postgres-js/migrator`, Node ≥ 22.18)     |
| Pruebas de integración | `test-integration/` (Node, `vitest.integration.config.ts`)                  |
| CI                     | `.github/workflows/db-migrations.yml` (contenedor `postgis/postgis:17-3.5`) |

### Reglas de uso

- Solo la capa `infrastructure` importa Drizzle o `@neondatabase/serverless`; el dominio usa
  tipos propios (`GeoPoint` en `src/shared/domain/geo-point.ts`). ESLint lo hace cumplir en
  `domain` y `application`.
- El cliente se crea **por request** desde `env.DATABASE_URL` en la raíz de composición
  (`src/composition/db.ts` → `buildDb(env)`) y se inyecta en los repositorios. Nunca se guarda
  en una variable global del módulo: los secretos solo llegan en `env` y el aislado de Workers
  se reutiliza entre requests.
- `neon-http` no admite transacciones interactivas. Si un caso de uso las necesita, usar
  `drizzle-orm/neon-serverless` con un `Pool` creado y cerrado dentro del mismo request.

### Tablas iniciales (especificación §5.1)

- `users`: `id uuid` (PK, `gen_random_uuid()`), `email` (único sin distinguir mayúsculas,
  índice `users_email_lower_key` sobre `lower(email)`), `phone`, `full_name`,
  `status` (`user_status`: `ACTIVE` | `SUSPENDED` | `DELETED`), `created_at`.
- `user_roles`: `user_id` (FK a `users`, `ON DELETE CASCADE`), `role` (enum `role`),
  `granted_at`, `granted_by` (FK a `users`, `ON DELETE SET NULL`); PK `(user_id, role)`.

El enum Postgres `role` se genera desde `Role` de `@panter/contracts`. Si se agrega un rol en
contracts, `pnpm db:generate` produce la migración `ALTER TYPE … ADD VALUE` correspondiente.

### Tipo `geography(Point,4326)`

`geographyPoint('columna')` es un `customType` de Drizzle que expone `{ lng, lat }`:

- **Escritura:** EWKT como texto, `SRID=4326;POINT(lng lat)` (la longitud va primero).
  PostgreSQL convierte el literal al tipo de la columna. Valida rangos (`RangeError`).
- **Lectura:** PostGIS entrega `geography` como EWKB en hexadecimal
  (`0101000020E6100000…`: orden de bytes, tipo con bandera de SRID, SRID 4326, x, y).
  `parseEwkbPoint` lo decodifica en el Worker sin pedirle nada extra a la base de datos.
  En consultas a mano también sirve `ST_AsGeoJSON(col)`, que `parseGeoPoint` acepta.

### Comandos

```bash
# Desde la raíz o desde api/core
pnpm db:generate                         # nueva migración SQL a partir del esquema
pnpm --filter @panter/api-core db:check  # consistencia de ./drizzle
DATABASE_URL=postgres://… pnpm db:migrate
DATABASE_URL=postgres://… pnpm --filter @panter/api-core test:integration
```

Para una migración SQL a mano (funciones, extensiones, datos):
`pnpm --filter @panter/api-core exec drizzle-kit generate --custom --name <nombre>`.

`pnpm test` corre solo las pruebas de Workers (`test/`) y no necesita base de datos; las de
`test-integration/` se omiten si no hay `DATABASE_URL`.

#### PostGIS local sin Neon

```bash
docker run -d --name panter-db -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=panter postgis/postgis:17-3.5
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/panter
pnpm db:migrate && pnpm --filter @panter/api-core test:integration
```

### Proyecto Neon (pendiente de cuenta)

> La creación del proyecto Neon está **pendiente de cuenta**. Estos son los pasos a seguir
> cuando exista.

1. En la consola de Neon crear el proyecto `panter` (PostgreSQL 17, región más cercana a
   Colombia, p. ej. `aws-us-east-1`) con la base de datos `panter`. La rama por defecto es
   **`main`** (producción).
2. Crear la rama **`staging`** desde `main` (Branches → New branch).
3. Cada desarrollador crea su rama **`dev-<nombre>`** desde `staging` para trabajo local.
4. Copiar la cadena de conexión de cada rama (Connect → con `sslmode=require`). Para el
   driver HTTP de los Workers sirve la cadena directa o la del pooler (`-pooler` en el host).
5. Aplicar las migraciones a cada rama: `DATABASE_URL=<cadena> pnpm db:migrate`. La primera
   migración ejecuta `CREATE EXTENSION IF NOT EXISTS postgis` (Neon la incluye).

### Dónde vive `DATABASE_URL`

| Ambiente   | Rama Neon      | Dónde se configura                                                       |
| ---------- | -------------- | ------------------------------------------------------------------------ |
| Local      | `dev-<nombre>` | `api/core/.dev.vars` (copiar `.dev.vars.example`; ignorado por git)      |
| Staging    | `staging`      | `wrangler secret put DATABASE_URL --env staging`                         |
| Producción | `main`         | `wrangler secret put DATABASE_URL --env production`                      |
| CI         | —              | Secreto `DATABASE_URL` de los GitHub Environments `staging`/`production` |

El workflow de despliegue `.github/workflows/api-core.yml` corre
`pnpm --filter @panter/api-core db:migrate` con el secreto `DATABASE_URL` del GitHub
Environment del ambiente (`staging` en push a `develop`, `production` en push a `main`) antes
de `wrangler deploy`; sin ese secreto no despliega. Las pruebas de PR no usan Neon: levantan un
contenedor PostGIS propio. Pasos completos en [Docs/DESPLIEGUE.md](../../Docs/DESPLIEGUE.md).

`DATABASE_URL` es opcional en la interfaz `Env` (`src/env.ts`) para que `/health` y las
pruebas de Workers funcionen sin base de datos; `createDb` falla con un mensaje claro si falta.

## Login (módulos `auth` y `email`)

| Pieza                   | Ubicación                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| Correo (HU-102)         | `src/modules/email/` · composición en `src/composition/email.ts`                                            |
| OTP por correo (HU-101) | `src/modules/auth/` · composición en `src/composition/auth.ts`                                              |
| Sesión JWT (HU-103)     | `application/session.ts`, `infrastructure/jose-access-tokens.ts`, `refresh-tokens.ts`                       |
| Middleware              | `requireAuth()` de `src/composition/auth.ts` + `getActor(c)` (`http/require-auth.ts`)                       |
| Rutas                   | `POST /auth/otp/request`, `/auth/otp/verify`, `/auth/refresh`, `/auth/logout`, `GET /.well-known/jwks.json` |
| Secretos y vars         | [Guía de despliegue](../../Docs/GUIA-DESPLIEGUE.md#secretos-y-variables-de-m1-login)                        |

- **OTP:** el código de 6 dígitos sale de `crypto.getRandomValues` (muestreo por rechazo, sin
  sesgo). En KV solo se guarda su HMAC-SHA256 con `OTP_SECRET`, y la clave KV también es un HMAC
  del correo. Vence a los 5 min. Se borra al verificarse (un solo uso) y la comparación es en
  tiempo constante.
- **Límites:** 3 códigos por correo cada 15 min (`OTP_RATE_LIMITED`, 429 con `Retry-After`).
  5 intentos por código; el 5.º fallo lo invalida (`OTP_TOO_MANY_ATTEMPTS`). KV es
  eventualmente consistente, así que los límites son aproximados entre ubicaciones; en el
  piloto se acepta.
- **Sin filtrar cuentas:** `request` no consulta la base de datos y siempre responde 202 con el
  mismo cuerpo. La cuenta (rol PASSENGER) se crea en `verify` con una sola sentencia
  (`users` + `user_roles`, `ON CONFLICT`).
- **Tokens:** el access token es un JWT RS256 de 15 min (jose). Lleva los claims de
  `AccessTokenClaimsSchema` y `kid` en el header. El refresh token es opaco (32 bytes
  base64url) y en KV se guarda su SHA-256 con un TTL de 30 días. Cada refresh rota el token;
  reutilizar uno ya rotado revoca toda la familia (sesión). Las llaves se generan con
  `scripts/generar_llaves_jwt.sh`.
- **Rutas protegidas (HU-104):** `router.use('/ruta/*', requireAuth())` y `getActor(c)` en el
  handler. Sin token devuelve 401 `UNAUTHENTICATED`; con el token vencido, 401 `TOKEN_EXPIRED`.
- **Pruebas:** `test/unit/` cubre dominio y casos de uso con dobles en memoria, en Node.
  `test/` cubre rutas y adaptadores en workerd. Ninguna llama a Brevo ni a Resend: usan
  `fetch` simulado. `test-integration/user-repository.test.ts` prueba el repositorio contra
  PostGIS real.
- **Cobertura:** `pnpm test` mide con `@vitest/coverage-istanbul` (funciona dentro de workerd;
  `coverage-v8` no). Falla si `modules/auth` o `modules/email` bajan de 90 % (85 % en ramas).
  Los repositorios Drizzle se miden en `test:integration`.
