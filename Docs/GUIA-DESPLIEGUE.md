# Guía paso a paso: desplegar PANTER en staging

Esta guía es para la persona dueña de las cuentas. Síguela en orden: cada paso deja algo listo
para el siguiente. Al final tendrás en staging la API, el servicio de tiempo real, la web y
una APK de prueba instalable.

- Todo se puede hacer desde el navegador (Cloudflare, Neon y GitHub). La terminal solo es
  necesaria para generar la llave de la APK (paso 8).
- Referencia técnica (qué hace cada workflow y cada secreto): [DESPLIEGUE.md](DESPLIEGUE.md).
- Tiempo estimado: 1 a 2 horas la primera vez.

> **Regla de oro:** los secretos (tokens, contraseñas, cadenas de conexión, llaves) van
> **solo** en GitHub o en Cloudflare. Nunca en el código, en un issue, en un PR ni en el chat.

## Mapa de lo que vas a configurar

| Dónde                           | Qué                                                                     | Paso |
| ------------------------------- | ----------------------------------------------------------------------- | ---- |
| GitHub → Branches               | Proteger `develop` y `main`                                             | 1    |
| Cloudflare                      | Subdominio `workers.dev`, Account ID, token de API                      | 2    |
| Cloudflare → Storage            | KV, R2 y colas de staging                                               | 3    |
| Neon                            | Proyecto `panter` con ramas `main` y `staging`                          | 4    |
| GitHub → Environment `staging`  | 3 secretos y 2 variables                                                | 5    |
| GitHub → Actions                | Primer despliegue en orden: realtime → api-core → web                   | 6    |
| Cloudflare → Worker api-core    | Secreto `DATABASE_URL` en tiempo de ejecución                           | 6    |
| Navegador                       | Verificar `/health`, `/openapi.json` y la web                           | 7    |
| Tu computador + GitHub          | Llave de firma de la APK y APK de staging                               | 8    |

**¿Y Firebase?** No se usa por ahora. La arquitectura v1.1 no usa Firebase para datos ni para
autenticación (eso lo hacen Neon y el OTP por correo). Solo se necesitará en el hito M5
(HU-1001, notificaciones push): Expo Push en Android exige credenciales de Firebase Cloud
Messaging. Esa configuración se documentará cuando lleguemos a esa historia.

## Paso 1 · Proteger las ramas en GitHub

1. Abre el repositorio → **Settings** → **Branches** → **Add branch protection rule**
   (o **Rules → Rulesets → New branch ruleset**).
2. En _Branch name pattern_ escribe `develop`.
3. Activa **Require status checks to pass before merging** y busca
   **`Lint, formato, tipos y pruebas`**. Selecciónalo.
4. Deja desactivado _Require branches to be up to date before merging_ y no exijas revisiones.
5. Guarda y repite para `main`.

Resultado: GitHub no deja fusionar un PR si el CI está en rojo.

## Paso 2 · Cuenta de Cloudflare

### 2.1 Subdominio `workers.dev`

1. Crea la cuenta en [dash.cloudflare.com](https://dash.cloudflare.com) (plan gratuito).
2. Ve a **Workers & Pages** (en el menú nuevo puede aparecer como **Compute → Workers**).
3. Si te pide elegir un subdominio, elige uno corto, por ejemplo `panter`. Tus URLs serán
   `https://panter-api-staging.<subdominio>.workers.dev`.
4. **Anota el subdominio.** Lo usarás en los pasos 5 y 7.

### 2.2 Account ID

En **Workers & Pages**, en la columna derecha, aparece **Account ID**. Cópialo. (También desde
el menú de la cuenta → _Copy account ID_.) No es secreto, pero lo guardaremos como secreto
para no repetirlo en los workflows.

### 2.3 Token de API

1. Avatar (arriba a la derecha) → **My Profile** → **API Tokens** → **Create Token** →
   **Create Custom Token** → _Get started_.
2. Nombre: `panter-github-actions`.
3. Permisos (todos de tipo **Account**):

   | Permiso            | Nivel |
   | ------------------ | ----- |
   | Workers Scripts    | Edit  |
   | Workers KV Storage | Edit  |
   | Workers R2 Storage | Edit  |
   | Queues             | Edit  |
   | Account Settings   | Read  |

4. _Account Resources_: **Include → tu cuenta**.
5. Sin filtro de IP (los servidores de GitHub cambian de IP) y sin fecha de vencimiento, o
   con una lejana que anotes para renovarlo.
6. **Continue to summary → Create Token.** Copia el token: Cloudflare lo muestra **una sola
   vez**. Pégalo directamente en GitHub en el paso 5.

## Paso 3 · Recursos de almacenamiento de staging

Desde el dashboard de Cloudflare, sección **Storage & Databases**:

| Recurso       | Dónde                                   | Nombre exacto              | Qué anotar         |
| ------------- | --------------------------------------- | -------------------------- | ------------------ |
| KV namespace  | **Workers KV → Create**                 | `panter-kv-staging`        | El **ID** (32 caracteres) |
| Bucket R2     | **R2 Object Storage → Create bucket**   | `panter-documents-staging` | Nada               |
| Cola          | **Queues → Create queue**               | `panter-events-staging`    | Nada               |

Notas importantes:

- **R2:** Cloudflare puede pedir que registres un medio de pago para activar R2, aunque el uso
  dentro de la capa gratuita no se cobra. Si no quieres registrarlo todavía, **avísame**: quito
  temporalmente el bucket de la configuración de staging (el código aún no lo usa; lo
  necesita HU-202, documentos de conductores).
- **Queues:** si el dashboard indica que Queues exige el plan de pago (USD 5/mes), **avísame**
  antes de pagar: puedo dejar la cola desactivada hasta que la usemos (HU-204 en adelante).
- Los nombres deben ser **exactamente** esos: `api/core/wrangler.jsonc` los usa.

**Envíame el ID del KV de staging y tu subdominio `workers.dev`** (no son secretos). Con eso
abro un PR que reemplaza el marcador `00000000000000000000000000000001` de
`api/core/wrangler.jsonc` y actualiza los ejemplos de URL. Si prefieres hacerlo tú, edita ese
archivo desde GitHub (botón del lápiz) en una rama nueva y abre un PR a `develop`.

> No fusiones ese PR hasta terminar el paso 6.1 (realtime debe existir antes que api-core).

## Paso 4 · Base de datos en Neon

1. Crea la cuenta en [neon.tech](https://neon.tech) (plan gratuito).
2. **New project**:
   - Nombre: `panter`
   - Versión de Postgres: **17**
   - Región: **AWS US East (N. Virginia)**, la más cercana a Colombia.
   - Base de datos: `panter`
3. La rama por defecto se llama `main` (será producción). Ve a **Branches → New branch**,
   nombre `staging`, creada desde `main`.
4. En el panel del proyecto → **Connect**:
   - _Branch_: `staging`
   - _Database_: `panter`
   - Activa **Connection pooling**.
   - Copia la cadena completa: `postgresql://…@ep-…-pooler.….neon.tech/panter?sslmode=require`.
5. No necesitas crear tablas ni activar PostGIS a mano: el workflow de despliegue aplica las
   migraciones (la primera activa PostGIS).

## Paso 5 · GitHub: Environment `staging`

1. Repositorio → **Settings** → **Environments** → **New environment** → nombre `staging`
   → _Configure environment_. (Si ya existe porque un workflow lo creó, ábrelo.)
2. En **Environment secrets → Add environment secret** crea:

   | Nombre                  | Valor                                       |
   | ----------------------- | ------------------------------------------- |
   | `CLOUDFLARE_API_TOKEN`  | Token del paso 2.3                          |
   | `CLOUDFLARE_ACCOUNT_ID` | Account ID del paso 2.2                     |
   | `DATABASE_URL`          | Cadena de la rama `staging` de Neon (paso 4) |

3. En **Environment variables → Add environment variable** crea:

   | Nombre                | Valor                                                        |
   | --------------------- | ------------------------------------------------------------ |
   | `NEXT_PUBLIC_API_URL` | `https://panter-api-staging.<subdominio>.workers.dev`        |
   | `EXPO_PUBLIC_API_URL` | `https://panter-api-staging.<subdominio>.workers.dev` (igual) |

   Sin barra `/` al final. Reemplaza `<subdominio>` por el del paso 2.1.

Diferencia entre **secreto** y **variable**: los secretos no se pueden volver a ver ni aparecen
en los logs; las variables sí. Las URLs públicas van como variables.

## Paso 6 · Primer despliegue (en este orden)

Los despliegues se lanzan desde **Actions**: eliges el workflow en la lista de la izquierda →
botón **Run workflow** → _Branch_: `develop` → ambiente `staging` → **Run workflow**. Espera a
que termine (círculo verde) antes de pasar al siguiente.

### 6.1 Deploy api-realtime

Crea el Worker `panter-realtime-staging` con sus 4 Durable Objects. Va primero porque
api-core se conecta a él.

### 6.2 Deploy api-core

Antes: fusiona el PR con el ID real del KV (paso 3). Ese merge puede lanzar el despliegue
solo; si no, lánzalo a mano.

Este workflow aplica las migraciones en la rama `staging` de Neon y luego crea el Worker
`panter-api-staging`.

Después, carga el secreto que el Worker lee **en tiempo de ejecución** (el de GitHub solo se
usa para migrar):

1. Cloudflare → **Workers & Pages** → `panter-api-staging` → **Settings** →
   **Variables and Secrets** → **Add**.
2. Tipo **Secret**, nombre `DATABASE_URL`, valor: la misma cadena de Neon de staging.
3. **Deploy** / guardar.

Los secretos del Worker se conservan entre despliegues: este paso se hace una sola vez por
ambiente. Más adelante se agregarán así las llaves JWT y de correo (M1); te diré cuáles en
cada historia.

### 6.3 Deploy web

Crea el Worker `panter-web-staging` con la web. Usa la variable `NEXT_PUBLIC_API_URL`, que
queda incrustada en el build: si la cambias, vuelve a lanzar este workflow.

### Si un workflow termina en verde pero dice "Despliegue omitido"

Abre la ejecución y lee el resumen: indica qué secreto o variable falta y en qué Environment.
Corrígelo y vuelve a lanzar el workflow.

## Paso 7 · Verificar

Abre en el navegador (reemplaza `<subdominio>`):

| URL                                                              | Qué debe mostrar                                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `https://panter-realtime-staging.<subdominio>.workers.dev/health` | `{"service":"panter-realtime","version":"0.1.0","commit":"<sha>"}`                                  |
| `https://panter-api-staging.<subdominio>.workers.dev/health`      | `"service":"panter-api"`, `"environment":"staging"` y `"realtime":{"status":"ok",…}`                |
| `https://panter-api-staging.<subdominio>.workers.dev/openapi.json` | El documento OpenAPI de la API                                                                    |
| `https://panter-web-staging.<subdominio>.workers.dev/`            | Portada provisional del portal, con el indicador de estado de la API en verde                     |
| `…/admin`, `…/despacho`, `…/operador`, `…/login`                  | Páginas provisionales (el login real llega en M1)                                                 |

Si `realtime` aparece como `"unreachable"`, revisa que el paso 6.1 haya terminado bien y
vuelve a lanzar **Deploy api-core**.

Logs en vivo de un Worker: Cloudflare → el Worker → **Logs** (o **Observability**).

## Paso 8 · App: llave de firma y APK de staging

### 8.1 APK de staging, sin llave

Sirve para probar ya mismo.

1. **Actions → App preview → Run workflow** en `develop`.
2. Al terminar, abre la ejecución y descarga el artefacto (sección **Artifacts**, al final).
   Es un `.zip` con la APK.
3. Pásala al teléfono e instálala (instrucciones en [app/README.md](../app/README.md)).
   Se instala como **PANTER (staging)** con el identificador `co.panter.app.staging`, así que
   no choca con la versión de producción.

Sin la llave real se firma con la llave de depuración y el workflow deja un aviso. Es normal
en pruebas.

### 8.2 Llave de firma real

Se genera **una sola vez en la vida del proyecto**. Hazlo antes de publicar la primera
versión en Releases.

Necesitas en tu computador: **Git Bash** (en Windows), **JDK 17** (trae `keytool`) y,
opcionalmente, **GitHub CLI** (`gh auth login`) para cargar los secretos automáticamente.

```bash
git clone https://github.com/Yadirtf/PANTER.git
cd PANTER
scripts/generar_keystore.sh ~/panter-keys/panter-upload.jks --subir
```

- Con `--subir` crea los 4 secretos del repositorio: `ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` y `ANDROID_KEY_PASSWORD`.
- Sin `--subir`, créalos a mano en **Settings → Secrets and variables → Actions → New
  repository secret**. El base64 queda en `~/panter-keys/panter-upload.jks.base64.txt`;
  bórralo después de cargarlo.
- **Guarda el archivo `.jks` y la contraseña en dos lugares seguros fuera del repositorio**
  (gestor de contraseñas y una copia cifrada). Si la llave se pierde, ninguna versión nueva
  se podrá instalar encima de la anterior.

Con la llave cargada, **App preview** firma con ella y deja de mostrar el aviso.

### 8.3 Primera versión en Releases

Se hace en producción, después de pasar `develop` a `main` (fuera de esta guía de staging).
Requiere el Environment `production` con `EXPO_PUBLIC_API_URL`. Los pasos están en
[app/README.md](../app/README.md#versiones-y-releases-responsables).

## Variables de entorno en tu computador (desarrollo local, opcional)

Solo si vas a ejecutar el proyecto en local. Los archivos reales están ignorados por git; se
copian del `.example`.

| Paquete    | Copiar                                       | Variables                                                    |
| ---------- | -------------------------------------------- | ------------------------------------------------------------ |
| `api/core` | `.dev.vars.example` → `.dev.vars`            | `DATABASE_URL` de una rama Neon personal `dev-<nombre>`      |
| `web`      | `.env.example` → `.env.local`                | `NEXT_PUBLIC_API_URL=http://localhost:8787`                  |
| `app`      | `.env.example` → `.env`                      | `APP_ENV=development`, `EXPO_PUBLIC_API_URL`                 |

```bash
pnpm install
pnpm --filter @panter/api-realtime dev   # terminal 1
pnpm --filter @panter/api-core dev       # terminal 2 → http://localhost:8787/health
pnpm --filter @panter/web dev            # terminal 3 → http://localhost:3000
```

## Solución de problemas

| Síntoma                                                               | Causa probable y solución                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| "Despliegue omitido" en el resumen del workflow                       | Falta un secreto o una variable en el Environment indicado (paso 5)                                           |
| `Authentication error [code: 10000]`                                  | Al token le falta un permiso o la cuenta en _Account Resources_ (paso 2.3)                                    |
| `KV namespace … not found` o `is not valid`                           | `api/core/wrangler.jsonc` todavía tiene el ID de marcador (paso 3)                                            |
| `bucket … does not exist` o `queue … does not exist`                  | Falta crear el recurso con el nombre exacto, o R2/Queues no están activados (paso 3)                          |
| Error del service binding `REALTIME` al desplegar api-core            | Despliega primero api-realtime (paso 6.1)                                                                     |
| Las migraciones fallan con `password authentication failed`           | Cadena de Neon mal copiada en `DATABASE_URL` de GitHub; cópiala de nuevo desde **Connect**                    |
| `/health` responde, pero lo que use la base de datos falla            | Falta el secreto `DATABASE_URL` del Worker (paso 6.2)                                                         |
| La web muestra la API como caída                                      | `NEXT_PUBLIC_API_URL` con error o con `/` al final; corrígela y relanza **Deploy web**                         |
| La primera consulta tarda 1–2 s                                       | Neon se suspende tras unos minutos sin uso (aceptado en pruebas, especificación §9)                           |
| El teléfono dice "conflicto de firma"                                 | Ver [app/README.md](../app/README.md)                                                                         |

## Qué me envías cuando termines

1. El **ID del KV de staging** y tu **subdominio `workers.dev`** (paso 3). Mejor al inicio,
   para tener listo el PR.
2. Qué pasos quedaron bien y cuáles fallaron, con el enlace a la ejecución de Actions o el
   texto del error. Nunca envíes valores de secretos.
3. Si R2 o Queues pidieron medio de pago o plan de pago, y qué decidiste.

Con eso corrijo lo que haga falta y seguimos con M1.
