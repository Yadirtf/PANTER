# App móvil PANTER

App Expo (React Native) para pasajeros y conductores. Se distribuye como APK en
[GitHub Releases](https://github.com/Yadirtf/PANTER/releases), sin Play Store
(Docs/ESPECIFICACION.md §10.2 y §10.3).

## Instalar la APK

1. En el teléfono Android abre la página de
   [Releases](https://github.com/Yadirtf/PANTER/releases/latest) y descarga
   `panter-<versión>.apk` (sección _Assets_).
2. Abre el archivo descargado (desde la notificación o la app _Archivos_ / _Descargas_).
3. La primera vez Android pide permiso para instalar apps de orígenes desconocidos: toca
   **Configuración**, activa **Permitir de esta fuente** para el navegador o el gestor de archivos
   que usaste y vuelve atrás. (En algunos teléfonos: _Ajustes > Seguridad > Instalar apps
   desconocidas_.)
4. Toca **Instalar**. Si Google Play Protect muestra un aviso, elige **Más detalles >
   Instalar de todas formas**: la app no viene de Play Store, pero está firmada por PANTER.

### Actualizar

Descarga la APK de la versión nueva e instálala **encima** de la que tienes, sin desinstalar: se
conservan la sesión y los datos. Android solo lo permite si la versión nueva tiene un
`versionCode` mayor y está firmada con la misma llave, y eso lo garantiza el workflow `app.yml`.

### "Conflicto de firma" o "La app no está instalada"

Este error indica que la APK instalada y la nueva se firmaron con llaves distintas. Suele pasar
cuando tienes una APK de prueba (artefacto de `app-preview.yml` firmado con la llave debug, o un
build local) con el mismo identificador. Las APK de staging se instalan como
`co.panter.app.staging` y no chocan con la de producción (`co.panter.app`).

1. Comprueba que descargaste la APK desde [Releases](https://github.com/Yadirtf/PANTER/releases).
   El certificado de firma SHA-256 aparece en las notas de cada Release y debe ser siempre el
   mismo.
2. Si la APK es la oficial, desinstala la app actual (_Ajustes > Apps > PANTER > Desinstalar_) e
   instala de nuevo. Se pierde la sesión: vuelve a ingresar con tu correo.
3. Si el SHA-256 de una Release nueva no coincide con el de las anteriores, no la instales y
   avisa al responsable: la llave de firma cambió.

## Versiones y Releases (responsables)

| Workflow                | Disparador                                       | Resultado                                                    |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| `app.yml`               | Tag `app-v*` (p. ej. `app-v0.3.0`) o manual      | APK de producción firmada adjunta a un Release con changelog |
| `app-preview.yml`       | Push a `develop` con cambios en `app/**`, manual | APK de staging como artefacto de la ejecución (14 días)      |
| `app-release-check.yml` | PR con cambios en la app o el camino de release  | Release firmado con un keystore temporal (sin publicar nada) |
| `app-android-build.yml` | PR con cambios en la app                         | `expo prebuild` + `assembleDebug`                            |

Publicar una versión:

```bash
git checkout main && git pull
git tag app-v0.3.0
git push origin app-v0.3.0
```

- `versionName` = el tag sin `app-v` (`0.3.0`; también `1.0.0-rc.1`, que se publica como
  pre-release).
- `versionCode` = `github.run_number` de `app.yml` + `VERSION_CODE_OFFSET` (100). Siempre crece.
  Si se renombra o se recrea `app.yml`, el contador vuelve a 1: sube `VERSION_CODE_OFFSET` por
  encima del último `versionCode` publicado.
- El changelog agrupa los Conventional Commits desde el tag `app-v*` anterior
  (`scripts/app_changelog.sh`): cambios incompatibles, `feat`, `fix` y otros.
- Ambos valores llegan a Expo como `APP_VERSION` y `APP_VERSION_CODE` (`app.config.ts` →
  `expo.version` y `android.versionCode`). En local se usan `0.1.0` y `1`.

Configuración en GitHub (_Settings_):

| Dónde                               | Nombre                                                                                              | Uso                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------- |
| Secrets del repositorio (Actions)   | `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Firma de release          |
| Environment `production` (variable) | `EXPO_PUBLIC_API_URL`                                                                               | API de producción (https) |
| Environment `staging` (variable)    | `EXPO_PUBLIC_API_URL`                                                                               | API de staging (https)    |

Sin los secretos del keystore `app.yml` falla de inmediato: una release firmada con otra llave
no se podría instalar encima de las anteriores. `app-preview.yml` sí funciona sin ellos (firma con
la llave debug y deja un aviso).

### Llave de firma (una sola vez)

```bash
scripts/generar_keystore.sh ~/panter-keys/panter-upload.jks          # solo genera
scripts/generar_keystore.sh ~/panter-keys/panter-upload.jks --subir  # y carga los 4 secretos con gh
```

Genera un keystore PKCS12 con RSA 4096 y validez de 10000 días, muestra su SHA-256 y deja el
base64 (`base64 | tr -d '\n'`) en `panter-upload.jks.base64.txt`. **Guarda el `.jks` y la
contraseña fuera del repositorio** (gestor de contraseñas y una copia cifrada) y borra el
`.base64.txt` después de cargar los secretos. Si la llave se pierde, ninguna versión nueva se
podrá instalar encima: todos tendrían que desinstalar la app.

### Cómo se firma

`expo prebuild` regenera `android/` en cada build (no se versiona), así que el config plugin
`plugins/with-release-signing.ts` añade `signingConfigs.release` a `android/app/build.gradle`.
Lee `PANTER_UPLOAD_STORE_FILE`, `PANTER_UPLOAD_STORE_PASSWORD`, `PANTER_UPLOAD_KEY_ALIAS` y
`PANTER_UPLOAD_KEY_PASSWORD` (variables de entorno o `-P`); sin ellas el release usa la llave debug.
La acción `.github/actions/android-release-apk` decodifica el keystore, ejecuta
`./gradlew assembleRelease` y verifica la firma y la versión con `apksigner` y `aapt2`.

Release firmado en local (requiere Android SDK y JDK 17):

```bash
cd app
APP_ENV=production EXPO_PUBLIC_API_URL=https://api.example.com pnpm prebuild
cd android
PANTER_UPLOAD_STORE_FILE=~/panter-keys/panter-upload.jks PANTER_UPLOAD_KEY_ALIAS=panter-upload \
  PANTER_UPLOAD_STORE_PASSWORD=... PANTER_UPLOAD_KEY_PASSWORD=... ./gradlew assembleRelease
```

Pruebas de los scripts de release: `bash scripts/probar_app_release.sh`.

## Código (desarrolladores)

Organizado por funcionalidad en `src/`:

| Carpeta          | Contenido                                                                           |
| ---------------- | ----------------------------------------------------------------------------------- |
| `app/`           | Rutas de Expo Router por grupo: `(auth)`, `(passenger)`, `(driver)`, `(onboarding)` |
| `shared/api/`    | Cliente HTTP tipado (`fetch` + esquemas Zod de `@panter/contracts`) y mensajes      |
| `features/auth/` | Login OTP, store de sesión y almacenamiento en `expo-secure-store`                  |
| `navigation/`    | `resolveRootGroup`: grupo de rutas según la sesión                                  |

- Todo error llega a la interfaz como `{ code, message }`; sin red el código es
  `NETWORK_ERROR`. Los textos en español están en `shared/api/error-messages.ts`.
- `SessionManager` (TypeScript puro) guarda refresh y access token en SecureStore. Antes de
  que venza el access token, o ante un 401 `TOKEN_EXPIRED`, llama una sola vez a
  `POST /auth/refresh` aunque haya varias peticiones a la vez, y reintenta. Si el refresh
  responde `REFRESH_TOKEN_INVALID`, cierra la sesión y la app vuelve al login.
- Las pruebas (`pnpm test`) simulan la API con un `fetch` falso (`src/test/fake-api.ts`).
