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
| Brevo + Cloudflare → Worker     | Secretos y variables del login (M1)                                     | M1   |

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
ambiente. Los del login (correo, OTP y llaves JWT) se cargan igual; ver
[Secretos y variables de M1 (login)](#secretos-y-variables-de-m1-login).

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

## Secretos y variables de M1 (login)

El login por código al correo (HU-101 a HU-103) necesita estos valores en el Worker
`panter-api-staging` (y luego en `panter-api` de producción). Ninguno es necesario para
`/health`: si falta alguno, el endpoint que lo usa responde `500 INTERNAL_ERROR` y el log del
Worker dice exactamente qué falta y cómo cargarlo.

| Nombre                   | Tipo    | Dónde se carga                              | Para qué                                         |
| ------------------------ | ------- | ------------------------------------------- | ------------------------------------------------ |
| `OTP_SECRET`             | Secreto | Cloudflare (o `wrangler secret put`)        | Llave del hash de los códigos en KV              |
| `BREVO_API_KEY`          | Secreto | Cloudflare (o `wrangler secret put`)        | Enviar el correo con el código (Brevo)           |
| `RESEND_API_KEY`         | Secreto | Cloudflare (opcional, cuando haya dominio)  | Respaldo automático (Resend)                     |
| `OTP_DEV_ECHO_ALLOWLIST` | Secreto | Cloudflare, solo staging (opcional)         | Correos de testers con el código en los logs     |
| `EMAIL_PROVIDER`         | Var     | `api/core/wrangler.jsonc` (ya viene)        | `brevo` (por defecto) o `resend`                 |
| `EMAIL_FROM`             | Var     | `api/core/wrangler.jsonc` (**hay que poner**) | Remitente verificado                           |
| `EMAIL_FROM_NAME`        | Var     | `api/core/wrangler.jsonc` (ya viene)        | Nombre visible: `PANTER`                         |
| `OTP_DEV_ECHO`           | Var     | `api/core/wrangler.jsonc` (ya viene)        | `true` en staging, `false` en producción         |

**Cómo cargar un secreto** (cualquiera de las dos formas):

- **Navegador:** Cloudflare → **Workers & Pages** → `panter-api-staging` → **Settings** →
  **Variables and Secrets** → **Add** → tipo **Secret** → nombre y valor → **Deploy**.
- **Terminal** (desde `api/core`, con sesión de `wrangler login`):
  `pnpm exec wrangler secret put NOMBRE --env staging` y pega el valor cuando lo pida.

Los secretos se conservan entre despliegues. Las **vars** no se cargan en Cloudflare: viven en
`api/core/wrangler.jsonc` y cada despliegue las sobrescribe con lo que diga ese archivo (por
eso no sirve editarlas en el dashboard). Para cambiarlas se edita el archivo en un PR.

### M1.1 · Brevo: remitente verificado y API key

Sin dominio propio, el correo sale desde un correo personal verificado en Brevo
(especificación §7.2). Usa una cuenta de Gmail **del proyecto**, no la personal.

1. Crea la cuenta gratuita en [brevo.com](https://www.brevo.com) (300 correos al día). Completa
   el perfil (nombre, empresa, dirección): Brevo puede dejar la cuenta "en validación" y no
   enviar nada hasta revisarla.
2. **Verificar el remitente:** menú de la cuenta (arriba a la derecha) → **Senders, Domains &
   Dedicated IPs** → pestaña **Senders** → **Add a sender**. Nombre `PANTER`, correo: el Gmail
   del proyecto → **Save**. Brevo envía un correo a esa dirección: ábrelo y confirma (enlace o
   código de 6 dígitos). Debe quedar con estado **Verified**. Brevo puede avisar que los
   correos gratuitos (Gmail) entregan peor: es esperable hasta tener dominio propio (§7.3).
3. **Crear la API key:** menú de la cuenta → **SMTP & API** → pestaña **API Keys** →
   **Generate a new API key** → nombre `panter-api-staging` → copia el valor (`xkeysib-…`;
   solo se muestra una vez).
4. **Permitir llamadas desde Cloudflare:** menú de la cuenta → **Security** → **Authorised
   IPs**. Si el bloqueo de IP desconocidas está activo, **desactívalo**: los Workers salen por
   IP variables y Brevo rechazaría el envío con `401 unauthorized`.
5. Carga el secreto `BREVO_API_KEY` en `panter-api-staging` (ver arriba).
6. Pon el Gmail verificado en `EMAIL_FROM` de `env.staging.vars` en `api/core/wrangler.jsonc`
   (hoy está vacío, marcado `MARCADOR`) y fusiona el PR. **Envíamelo y abro yo el PR** si
   prefieres (no es un secreto: aparece en todos los correos).

Comprobación (cuando esté HU-101, el endpoint de login): pide un código desde la web o con
`curl -X POST https://panter-api-staging.<subdominio>.workers.dev/auth/otp/request -H 'content-type: application/json' -d '{"email":"tu-correo@gmail.com"}'`.
Debe responder `202` y el correo llegar con el asunto **"Tu código PANTER es 123456"** (con tu
código). Si no llega, revisa **Spam** o **Promociones**, márcalo como "No es spam" y agrega el
remitente a tus contactos. En Brevo → **Transactional** → **Logs** se ve cada envío.

**Resend (después, con dominio propio):** cuando exista `mail.<dominio>` verificado en Resend
(SPF/DKIM), crea la API key en Resend → **API Keys** → **Create API key** (permiso _Sending
access_) y cárgala como `RESEND_API_KEY`. Desde ese momento Resend queda de respaldo automático
de Brevo (si Brevo falla o agota su cuota diaria con 429). Para que Resend sea el principal,
cambia `EMAIL_PROVIDER` a `resend` y `EMAIL_FROM` a la dirección del dominio en
`wrangler.jsonc`. Resend no envía desde Gmail: no cargues `RESEND_API_KEY` antes de tener el
dominio, o los respaldos fallarán.

### M1.2 · OTP_DEV_ECHO en staging (código en los logs)

Para probar el login aunque el correo tarde o caiga en spam, en staging la API también puede
escribir el código en los logs del Worker, **solo** para los correos de una lista blanca de
testers. En producción es imposible: el código exige `ENVIRONMENT=staging` aunque
`OTP_DEV_ECHO` valga `true` (hay una prueba automática que lo verifica).

1. `OTP_DEV_ECHO` ya vale `"true"` en `env.staging` de `wrangler.jsonc` (y `"false"` en
   producción). Para apagarlo del todo, cámbialo a `"false"` en un PR.
2. Carga el secreto `OTP_DEV_ECHO_ALLOWLIST` en `panter-api-staging` con los correos de los
   testers separados por comas, por ejemplo `ana@gmail.com,beto@gmail.com`. Va como secreto
   (y no en `wrangler.jsonc`) porque el repositorio es público y son correos personales.
3. Pide un código con uno de esos correos. En Cloudflare → `panter-api-staging` → **Logs**
   (o **Observability** → **Events**), busca `otp_dev_echo`: verás
   `{ "event": "otp_dev_echo", "to": "ana@gmail.com", "code": "123456" }`. El correo se envía
   igual; si Brevo falla, el tester puede seguir con el código del log
   (evento `otp_email_failed_echoed`).
4. En vivo desde la terminal: `pnpm exec wrangler tail panter-api-staging --search otp_dev_echo`.

### M1.3 · OTP_SECRET (hash de los códigos)

La API nunca guarda el código ni el correo en claro: en KV solo queda su HMAC-SHA256 con esta
llave. Es un valor aleatorio distinto por ambiente.

1. Genéralo en tu computador: `openssl rand -hex 32` (64 caracteres hexadecimales). Sin
   terminal, sirve cualquier generador de contraseñas de 64 caracteres; el mínimo aceptado son
   32.
2. Cárgalo como secreto `OTP_SECRET` en `panter-api-staging` (y otro distinto en `panter-api`).
3. Si lo cambias, los códigos pendientes dejan de servir (los usuarios piden uno nuevo) y se
   reinicia el límite de solicitudes. No afecta las cuentas.

Límites del OTP (especificación §7.4): 3 códigos por correo cada 15 minutos, 5 intentos por
código y 5 minutos de vigencia. Se guardan en KV, que es **eventualmente consistente** (un
cambio puede tardar hasta ~60 s en verse en otras ubicaciones de Cloudflare): en el piloto se
acepta que, con peticiones casi simultáneas desde lugares distintos, el límite se exceda por
poco.

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
