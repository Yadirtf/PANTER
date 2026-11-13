# Despliegue y CI/CD

Cómo se valida y despliega PANTER (Especificación §10). Este documento es la lista de tareas
del dueño de las cuentas: hasta que los secretos existan, los workflows de despliegue terminan
en verde con el aviso _"Despliegue omitido"_ y no publican nada.

> ¿Primera vez? Sigue la guía paso a paso [GUIA-DESPLIEGUE.md](GUIA-DESPLIEGUE.md). Este
> documento es la referencia técnica.

## 1. Workflows

| Workflow           | Disparador                                                         | Qué hace                                                                                      |
| ------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `ci.yml`           | PR y push a `develop`/`main`                                       | ESLint y Prettier (todo el repo); TypeScript y pruebas de los paquetes afectados; `--dry-run` |
| `db-migrations.yml`| PR con cambios en `api/core/**` o `packages/**`                    | Migraciones Drizzle y pruebas de integración sobre PostGIS en contenedor                      |
| `web-build.yml`    | PR con cambios en `web/**` o `packages/**`                         | Build OpenNext sin desplegar                                                                  |
| `api-realtime.yml` | Push a `develop`/`main` con cambios en `api/realtime/**`, `packages/**` | `wrangler deploy --env <ambiente>` (incluye migraciones de Durable Objects)              |
| `api-core.yml`     | Push a `develop`/`main` con cambios en `api/core/**`, `packages/**` | `pnpm --filter @panter/api-core db:migrate` → `wrangler deploy --env <ambiente>`             |
| `web.yml`          | Push a `develop`/`main` con cambios en `web/**`, `packages/**`     | Build OpenNext → `opennextjs-cloudflare deploy --env <ambiente>`                              |

Los tres workflows de despliegue también se disparan con cualquier cambio en `pnpm-lock.yaml`
o en el propio workflow, y se pueden lanzar a mano (Actions → _Run workflow_) eligiendo
`staging` o `production`. `production` solo se acepta desde `main`.

| Rama      | Ambiente (GitHub Environment y `--env` de Wrangler) | Workers                                                  |
| --------- | --------------------------------------------------- | -------------------------------------------------------- |
| `develop` | `staging`                                           | `panter-api-staging`, `panter-realtime-staging`, `panter-web-staging` |
| `main`    | `production`                                        | `panter-api`, `panter-realtime`, `panter-web`            |

Cada despliegue pasa `--var APP_VERSION:<version de package.json> --var GIT_COMMIT:<sha>`;
api-core y api-realtime los muestran en `GET /health`.

### Paquetes afectados en `ci.yml`

En un PR, TypeScript y pruebas corren con `pnpm --filter "...[origin/<base>]"`: los paquetes
con archivos cambiados y los que dependen de ellos (un cambio en `packages/contracts` valida
también api-core y web). Corren en **todos** los paquetes si el PR toca un archivo raíz
(`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
`eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.nvmrc` o `.github/**`) y en cada
push a `develop`/`main`. ESLint y Prettier siempre son globales: tardan segundos y las reglas
de fronteras entre paquetes deben revisarse completas.

El job `Configuración de despliegue (wrangler --dry-run)` compila api-core y api-realtime para
`staging` y `production` sin cuenta de Cloudflare, y atrapa errores de `wrangler.jsonc`.

## 2. Secretos y variables

Especificación §10.4. Nada de esto va en el repositorio.

### 2.1. GitHub (Settings → Environments)

Crear los Environments **`staging`** y **`production`** (los workflows los crean vacíos la
primera vez que corren). En `production` conviene activar _Deployment branches → Selected
branches → `main`_ y, si se quiere, _Required reviewers_.

| Nombre                  | Tipo     | Ambientes            | Usado por                       | Valor                                                    |
| ----------------------- | -------- | -------------------- | ------------------------------- | -------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Secreto  | staging y production | api-core, api-realtime, web     | Token de la sección 3                                    |
| `CLOUDFLARE_ACCOUNT_ID` | Secreto  | staging y production | api-core, api-realtime, web     | Dashboard de Cloudflare → Workers & Pages → _Account ID_ |
| `DATABASE_URL`          | Secreto  | staging y production | api-core (migraciones)          | Cadena de la rama Neon `staging` o `main`                |
| `NEXT_PUBLIC_API_URL`   | Variable | staging y production | web (se incrusta en el build)   | `https://panter-api-staging.<subdominio>.workers.dev` o `https://panter-api.<subdominio>.workers.dev` |

`CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` pueden ser también secretos del repositorio
(Settings → Secrets and variables → Actions) si se usa la misma cuenta en ambos ambientes;
`DATABASE_URL` debe ser del Environment, porque cambia por ambiente.

Si falta un secreto, el job lo informa con `::warning::` y en el resumen de la ejecución, y no
despliega. api-core tampoco despliega sin `DATABASE_URL`: las migraciones van siempre antes que
el código.

Más adelante (APK, HU-008): `ANDROID_KEYSTORE_BASE64`, contraseñas y alias del keystore como
secretos del repositorio.

### 2.2. Workers (`wrangler secret put`)

Los secretos que lee el código en tiempo de ejecución se cargan en cada Worker, una vez por
ambiente (persisten entre despliegues). Desde `api/core`:

```bash
pnpm exec wrangler secret put DATABASE_URL --env staging      # y --env production
pnpm exec wrangler secret put JWT_PRIVATE_KEY --env staging   # cuando exista HU-101
pnpm exec wrangler secret put JWT_PUBLIC_KEY --env staging
pnpm exec wrangler secret put BREVO_API_KEY --env staging
pnpm exec wrangler secret put RESEND_API_KEY --env staging
pnpm exec wrangler secret put ORS_API_KEY --env staging
pnpm exec wrangler secret put SENTRY_DSN --env staging
```

Solo `DATABASE_URL` existe hoy en `src/env.ts`; los demás llegan con sus historias. En local
van en `api/core/.dev.vars` (ignorado por git).

## 3. Token de Cloudflare

Dashboard → _My Profile_ → _API Tokens_ → _Create Token_ → _Create Custom Token_:

| Alcance | Permiso                | Nivel |
| ------- | ---------------------- | ----- |
| Account | Workers Scripts        | Edit  |
| Account | Workers KV Storage     | Edit  |
| Account | Workers R2 Storage     | Edit  |
| Account | Queues                 | Edit  |
| Account | Account Settings       | Read  |

_Account Resources_: incluir solo la cuenta de PANTER. Sin restricción de IP (los runners de
GitHub cambian de IP). Guardar el token en `CLOUDFLARE_API_TOKEN` (sección 2.1).

La primera vez, la cuenta debe tener un subdominio `workers.dev` registrado (Workers & Pages →
_Subdomain_); de él salen las URLs de la tabla §10.1.

## 4. Recursos a crear (una vez por cuenta)

Con `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` exportados, desde `api/core`:

```bash
# KV (uno por ambiente). Cada comando imprime el id.
pnpm exec wrangler kv namespace create panter-kv-staging
pnpm exec wrangler kv namespace create panter-kv

# R2 (documentos de conductores)
pnpm exec wrangler r2 bucket create panter-documents-staging
pnpm exec wrangler r2 bucket create panter-documents

# Colas (eventos de dominio)
pnpm exec wrangler queues create panter-events-staging
pnpm exec wrangler queues create panter-events
```

Los Durable Objects de api-realtime no se crean a mano: `wrangler deploy` aplica las
`migrations` de su `wrangler.jsonc`. Los recursos `*-dev` del nivel superior de
`api/core/wrangler.jsonc` solo los usa `wrangler dev` (simulados por Miniflare).

### Reemplazar los IDs de marcador

`api/core/wrangler.jsonc` trae IDs de KV falsos marcados con `MARCADOR`:

| Entorno         | Marcador actual                    | Reemplazar por                     |
| --------------- | ---------------------------------- | ---------------------------------- |
| `env.staging`   | `00000000000000000000000000000001` | id de `panter-kv-staging`          |
| `env.production`| `00000000000000000000000000000002` | id de `panter-kv`                  |

El de nivel superior (`…0000`) se queda: es el KV local de `wrangler dev` y de las pruebas.
Los IDs de KV no son secretos: el cambio va en un PR normal a `develop`.

## 5. Orden de despliegue

api-core llama a api-realtime por _service binding_ (`REALTIME` → `panter-realtime-staging` /
`panter-realtime`), así que **api-realtime debe existir antes** en cada ambiente. Los
workflows corren en paralelo cuando un push toca ambas carpetas, por eso la primera vez:

1. Cargar los secretos (sección 2.1), crear los recursos y reemplazar los IDs (sección 4).
2. Neon: aplicar migraciones y cargar `DATABASE_URL` en el Worker (sección 2.2; el workflow
   también migra en cada despliegue).
3. Actions → **Deploy api-realtime** → _Run workflow_ en `develop` con `staging`.
4. Actions → **Deploy api-core** → _Run workflow_ en `develop` con `staging`.
5. Definir `NEXT_PUBLIC_API_URL` en el Environment `staging` con la URL de panter-api-staging
   y lanzar **Deploy web**.
6. Comprobar `GET https://panter-api-staging.<subdominio>.workers.dev/health` (debe mostrar la
   versión y el commit de api-core y de realtime).
7. Repetir en `main` con `production`.

Después, cada push a `develop`/`main` despliega solo lo que cambió.

## 6. Protección de ramas

`develop` y `main` exigen el check **`Lint, formato, tipos y pruebas`** de `ci.yml` antes de
fusionar. Se configura a mano (el token de los agentes no tiene permiso de administración):

1. Settings → _Branches_ → _Add branch protection rule_ (o _Rules → Rulesets_).
2. _Branch name pattern_: `develop`. Repetir para `main`.
3. Activar _Require status checks to pass before merging_ y buscar
   `Lint, formato, tipos y pruebas` (aparece tras la primera ejecución de CI). Dejar
   desactivado _Require branches to be up to date_.
4. No exigir revisiones ni incluir administradores (un solo desarrollador).

Equivalente con la API (requiere un token con permiso de administración del repositorio):

```bash
for rama in develop main; do
  gh api -X PUT "repos/Yadirtf/PANTER/branches/$rama/protection" --input - <<'JSON'
{
  "required_status_checks": { "strict": false, "contexts": ["Lint, formato, tipos y pruebas"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
done
```

Los jobs de despliegue no son checks obligatorios: corren después del merge.
