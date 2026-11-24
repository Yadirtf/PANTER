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
| `app-preview.yml`       | Push a `develop` con cambios en `app/**`, manual | APK de staging como artefacto de la ejecución (2 días)       |
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

| Carpeta                   | Contenido                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `app/`                    | Rutas de Expo Router por grupo: `(auth)`, `(web-only)`, `(onboarding)`, `(passenger)`, `(driver)` |
| `shared/api/`             | Cliente HTTP tipado (`fetch` + esquemas Zod de `@panter/contracts`) y mensajes                    |
| `features/auth/`          | Login OTP, store de sesión y almacenamiento en `expo-secure-store`                                |
| `navigation/`             | `resolveRootGroup`: grupo de rutas según la sesión                                                |
| `features/map/`           | `<PanterMap>` (HU-303): mapa de Google, puntos clave y ubicación                                  |
| `features/fare-estimate/` | Destino, vehículo y estimado del pasajero con `POST /fares/estimate` (HU-404)                     |
| `features/catalog/`       | Barrios, veredas y lugares de la API con copia en el teléfono y descripción de puntos (HU-311)    |

- Todo error llega a la interfaz como `{ code, message }`; sin red el código es
  `NETWORK_ERROR`. Los textos en español están en `shared/api/error-messages.ts`.
- `SessionManager` (TypeScript puro) guarda refresh y access token en SecureStore. Antes de
  que venza el access token, o ante un 401 `TOKEN_EXPIRED`, llama una sola vez a
  `POST /auth/refresh` aunque haya varias peticiones a la vez, y reintenta. Si el refresh
  responde `REFRESH_TOKEN_INVALID`, cierra la sesión y la app vuelve al login.
- `resolveRootGroup(session)` (sección 5.4): sin sesión → `(auth)`; solo roles de personal →
  `(web-only)` (aviso "Usa la web"); modo conductor sin rol DRIVER → `(onboarding)`; con DRIVER →
  `(driver)`; en otro caso → `(passenger)`. Al abrir la app con sesión se llama a `GET /me`.
- El selector de modo (`POST /me/mode`) solo aparece con el rol DRIVER.
- `EXPO_PUBLIC_WEB_URL` (opcional) es la URL de la web del aviso; si falta, se deduce del Worker
  de la API en workers.dev (`panter-api-staging.<subdominio>` → `panter-web-staging.<subdominio>`).
- Las pruebas (`pnpm test`) simulan la API con un `fetch` falso (`src/test/fake-api.ts`).

## Mapa (HU-303)

`<PanterMap mode="passenger" | "driver">` (`src/features/map/components/panter-map.tsx`) dibuja un
mapa de **Google Maps** con [`react-native-maps`](https://github.com/react-native-maps/react-native-maps)
1.29.11 (la versión de `bundledNativeModules.json` de Expo 58) y `PROVIDER_GOOGLE`. Antes era
MapLibre con un mapa propio de OpenStreetMap; se cambió porque las rutas ahora salen de Google
Routes API y sus condiciones exigen mostrarlas sobre un mapa de Google.

1. Tema con `themeFor(new Date())` (hora de Colombia): de noche usa `NIGHT_STYLE`
   (`src/features/map/google-map.ts`). Un temporizador lo reevalúa a las 20:00 y a las 05:00.
2. Cámara en `PLACES.VILLAGARZON_CENTER`, limitada a `SERVICE_AREA` con `setMapBoundaries`.
3. Puntos clave (`KEY_PLACES` de `@panter/map-style`) como marcadores con su ícono
   (`iconPngDataUrl(id, 3)`).
4. Tocar un lugar de Google (`onPoiClick`) o un punto clave lo propone como destino (HU-311).
5. Ubicación en primer plano con `expo-location`: punto del usuario, botón "centrar en mi
   ubicación" y avisos para permiso negado o bloqueado, GPS apagado y fuera del área.
6. `mapPadding` deja el logo de Google (obligatorio) encima del panel inferior.

**Clave del SDK.** El build lee `GOOGLE_MAPS_ANDROID_API_KEY` (`.env` local, secreto de GitHub
del mismo nombre en los Environments `staging` y `production`). Sin ella compila, pero el mapa
muestra "Mapa no disponible" (sin aviso, el SDK cerraría la app). En Google Cloud la clave se restringe a **Maps SDK for Android** y a cada paquete
(`co.panter.app`, `co.panter.app.staging`, `co.panter.app.dev`) con la huella SHA-1 de su
llave de firma. El SDK móvil sin Map ID no tiene costo.

**Sin señal.** Google no permite descargar su mapa desde una app, así que se quitó la descarga
del mapa para conductores (§6.1). Google guarda en caché las zonas ya vistas.

## Estimado del pasajero (HU-404)

En el modo pasajero (`src/features/fare-estimate/`):

- **Destino** ("¿A dónde vas?", HU-311), sin geocodificadores externos:
  - **Lugares:** catálogo de `GET /places` con buscador sin tildes (`searchKey`) y categorías
    (`PLACE_CATEGORY_LABELS`); los no verificados llevan la insignia "Ubicación aproximada". El
    destino es su `pickupPoint` si lo tiene; si no, su `location`. De `@panter/map-style` solo se
    usan los íconos.
  - **Barrios y veredas:** `GET /areas` agrupado por tipo; al elegir uno, `GET /areas/:id` dibuja
    su croquis y la cámara lo encuadra; se toca el punto exacto dentro (`pointInPolygon`) y, si se
    toca fuera, se avisa.
  - **Tocar el mapa:** un punto cualquiera, o un establecimiento con nombre del mapa base
    (`queryRenderedFeatures` sobre las capas `pois` de Protomaps y `panter-places`), que se toma con
    su nombre. Siempre con "Confirmar destino".
  - La última respuesta de `/areas`, `/places` y de cada croquis consultado queda en
    `<documentos>/catalog/` para usarla sin señal.
- **Descripción** de recogida y destino siempre visible: "Barrio Centro · cerca de Parque
  principal" (`GET /areas/locate`, `GET /places/nearby` y `describeLocation`), con debounce de
  600 ms y caché por coordenada redondeada a 4 decimales; sin señal, con la copia del catálogo.
- **Calidad de la ruta (HU-307):** si `route.quality` dice que el origen o el destino quedaron a
  más de 50 m de la vía, se avisa, se marca en el mapa el punto donde empieza o termina la ruta y
  se ofrece "Mover el pin a la vía" o "Está bien así". Si la ruta es inusual, se avisa y se dibuja
  la línea recta punteada. Sin `quality`, nada cambia.
- **Origen:** la ubicación actual (dentro del área de servicio); el pin verde se arrastra para
  cambiarlo. Sin GPS, el origen es el parque principal hasta que se mueva el pin.
- **Vehículo:** mototaxi o taxi; el 4x4 aparece como "Próximamente".
- `POST /fares/estimate` (con sesión): se dibuja la ruta (`decodePolyline`) y se muestran
  distancia, tiempo, total en COP (`$ 19.500`) y el desglose con los labels de la API, en el
  orden del cálculo (base, distancia, tiempo, mínima, nocturno, aeropuerto o periferia, redondeo).
- **Vigencia:** cuenta regresiva hasta `validUntil`. Al vencer se renueva sola una vez y avisa
  "Precio actualizado" (con el total anterior si cambió); la siguiente vez pide tocar "Actualizar
  precio", para no gastar consultas de rutas con la pantalla abierta.
- **Errores** en español, sin precios simulados: `OUT_OF_SERVICE_AREA` y `ROUTE_NOT_FOUND` piden
  otro punto, `FARE_RULE_NOT_FOUND` sugiere otro vehículo y `ROUTING_UNAVAILABLE` (hoy en staging,
  sin `ORS_API_KEY`) y la falta de red muestran "Reintentar".
- "Pedir viaje" queda deshabilitado con la leyenda "Disponible pronto" (los viajes llegan en M4).

El flujo es un reducer puro (`estimate/planner.ts`) con pruebas de selección, desglose, formato,
vencimiento y errores.
