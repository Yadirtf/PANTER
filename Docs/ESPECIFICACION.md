# PANTER — Especificación Técnica y Arquitectura v1.1

Plataforma de Movilidad y Ecoturismo de Villagarzón · Nov 12, 2026 · @Inge

## Control de cambios (v1.0 → v1.1)

La versión 1.1 reemplaza a la 1.0. Adapta la arquitectura a una operación en capa gratuita (Cloudflare + Neon), con un solo desarrollador, una sola app móvil y distribución de APK sin Play Store durante la etapa de pruebas.

| Área | v1.0 | v1.1 | Motivo |
| --- | --- | --- | --- |
| Apps móviles | Dos apps: pasajero y conductor | Una sola app con navegación por rol y modo activo | Menos mantenimiento; una persona puede ser pasajero y conductor |
| Infraestructura | Microservicios en Docker, Nginx/Kong, VPS/AWS | Cloudflare Workers, Durable Objects, Queues, KV, R2 | Capa gratuita, sin servidores que administrar |
| Base de datos | PostgreSQL 16 + PostGIS autogestionado | Neon (Postgres serverless + PostGIS), ramas por ambiente | Gratis, con ramas para dev/staging/producción |
| Tiempo real | Socket.io + Redis GEO | WebSockets en Durable Objects | Socket.io y Redis no corren en Workers |
| Mensajería | RabbitMQ | Cloudflare Queues | Equivalente administrado |
| Mapas | Mapbox GL | MapLibre + Protomaps (OSM) + OpenRouteService | 100 % gratuito, sin tarjeta |
| Autenticación | OTP por SMS/WhatsApp | OTP por correo (Resend + Brevo); SMS/WhatsApp en fase posterior | Costo cero |
| Servicios backend | 10 microservicios | 2 Workers: `api-core` y `api-realtime`, divisibles después | Escala de un desarrollador |
| Gobernanza | 2 revisores por PR, 80 % de cobertura global | CI obligatorio sin revisores; cobertura alta en dominio crítico | Un solo responsable del repositorio |
| Distribución móvil | Play Store y App Store | APK firmada publicada en GitHub Releases | Etapa de pruebas sin tiendas |
| Dominio | Propio | Subdominios `*.workers.dev` de Cloudflare; dominio propio más adelante | Sin compra por ahora |

## 1. Contexto, visión y alcance

PANTER es una plataforma de transporte bajo demanda y ecoturismo para Villagarzón (Putumayo). Integra mototaxis urbanos, taxis, camperos 4x4 y circuitos ecoturísticos, con conexión al Aeropuerto Cananguchal (VGZ). El contexto y el problema de la v1.0 se mantienen sin cambios.

El ecosistema se reduce a tres canales: una app móvil única (pasajero y conductor), una web (portal turístico público, panel administrativo, consola de despacho y panel de operador turístico) y una API.

### 1.1. Modalidades de transporte

| Modalidad | Radio operativo | Esquema de cobro | Fase |
| --- | --- | --- | --- |
| Mototaxi urbano | Casco urbano y barrios periféricos | Tarifa base plana diurna/nocturna con recargo por zona periférica | 1 |
| Taxi convencional | Urbano y conexión al aeropuerto | Tiempo/distancia o precio sugerido, con recargo aeroportuario | 1 |
| Campero / 4x4 rural | Vías terciarias y balnearios | Tarifa fija por destino o por horas, hasta 8 pasajeros | 2 |
| Circuito ecoturístico | Ida/vuelta con espera y guía opcional | Paquete reservado con anticipación | 2 |

### 1.2. Fuera de alcance en v1.1

Quedan fuera, hasta tener dominio y presupuesto: publicación en Play Store y App Store, OTP por SMS/WhatsApp, pasarelas Nequi/Daviplata/PSE en producción, rutas intermunicipales y analítica predictiva.

## 2. Metodología y gobernanza

El proyecto usa un monorepo con pnpm workspaces y despliegues independientes por carpeta. Se trabaja con sprints de 2 semanas y un backlog de épicas e historias en GitHub Issues.

### 2.1. Estructura del repositorio

```
PANTER/
├── api/
│   ├── core/              Worker "panter-api" (Hono, REST)
│   └── realtime/          Worker "panter-realtime" (Durable Objects)
├── web/                   Worker "panter-web" (Next.js + OpenNext)
├── app/                   App móvil Expo (React Native + MapLibre)
├── packages/
│   └── contracts/         Esquemas Zod, tipos, enums y constantes compartidas
├── Docs/                  Especificación y decisiones (ADR)
├── .github/workflows/     api-core.yml, api-realtime.yml, web.yml, app.yml, ci.yml
└── pnpm-workspace.yaml
```

Cada carpeta tiene su propio `package.json`, configuración y pipeline. Solo `packages/contracts` se comparte; ninguna app importa código de otra.

### 2.2. Ramas (Gitflow simplificado)

- `main`: producción. Solo recibe merges desde `develop` o `hotfix/*`, con tag SemVer.
- `develop`: integración; se despliega automáticamente a staging.
- `feature/<issue>-<descripcion>`: una rama por historia, por ejemplo `feature/23-login-otp`.
- `hotfix/*`: correcciones urgentes sobre `main`, propagadas a `develop`.

### 2.3. Reglas de calidad para un solo responsable

- PR obligatorio hacia `develop` y `main`; sin revisores requeridos.
- El PR debe pasar CI: ESLint, Prettier, `tsc --noEmit` y pruebas (Vitest).
- Cobertura mínima de 80 % solo en módulos críticos: tarifas, máquina de estados del viaje, billetera y RBAC.
- Cada PR referencia su issue (`Closes #23`) para que el tablero avance solo.
- Commits con Conventional Commits (`feat:`, `fix:`, `chore:`), base para changelog y versiones.
- Decisiones de arquitectura registradas como ADR cortos en `Docs/adr/`.

## 3. Arquitectura en Cloudflare

El backend es un monolito modular repartido en dos Workers: `api-core` (REST) y `api-realtime` (estado en vivo). Se comunican por Service Bindings, sin pasar por internet público. Cualquier módulo puede extraerse a su propio Worker sin cambiar el contrato.

### 3.1. Servicios

| Servicio | Responsabilidad | Recursos Cloudflare |
| --- | --- | --- |
| `api-core` | Auth/OTP, usuarios y roles, conductores y documentos, tarifas, viajes (persistencia), turismo, billetera, calificaciones, administración | Worker + Hono, KV (rate limit, OTP), R2 (documentos), Queues (productor) |
| `api-realtime` | Tracking GPS, matching con ofertas de 15 s, difusión de estado del viaje, SOS en vivo | Durable Objects con WebSockets (hibernación) y alarmas |
| Consumidor de colas | Comisión al finalizar viaje, recibos, notificaciones, métricas | Queues (consumidor dentro de `api-core`) |
| `panter-web` | Portal turístico, admin, despacho, operador | Worker con Next.js vía OpenNext |
| Neon | Datos transaccionales y geoespaciales | Postgres + PostGIS, driver serverless |

### 3.2. Durable Objects

- `DriverTracker`: uno por conductor conectado. Recibe GPS, guarda la última posición y la reenvía a los suscriptores del viaje activo.
- `ZoneIndex`: índice de conductores disponibles por celda geográfica (geohash). Reemplaza a `GEORADIUS` de Redis.
- `TripRoom`: uno por viaje. Ejecuta el matching (radio inicial 2 km, oferta de 15 s con `alarm()`, escalado al siguiente), la máquina de estados y la sala WebSocket de pasajero, conductor y despacho.
- `OpsHub`: canal para la consola web (flota en vivo y alertas SOS).

### 3.3. Equivalencias con v1.0

| Componente v1.0 | Reemplazo v1.1 |
| --- | --- |
| API Gateway Nginx/Kong | Router Hono + middleware JWT y rate limit |
| Auth & Identity Service | Módulo `auth` en `api-core` |
| Driver & Compliance + MinIO/S3 | Módulo `drivers` + R2 |
| Geolocation & Tracking (Socket.io, Redis GEO) | `DriverTracker` + `ZoneIndex` |
| Trip Matching Engine | `TripRoom` + módulo `trips` |
| Pricing Engine | Módulo `pricing` con tablas paramétricas en Neon |
| Turismo & Circuitos | Módulo `tourism` |
| Payments & Wallet | Módulo `wallet` (efectivo y billetera prepago) |
| Safety & SOS | `TripRoom`/`OpsHub` + módulo `safety` |
| Notification Service (FCM) | Consumidor de Queues + Expo Push (gratuito) |
| RabbitMQ | Cloudflare Queues |
| Prometheus, Grafana, Loki | Workers Logs y Analytics + Sentry (plan gratuito) |

### 3.4. Eventos de dominio

Los eventos viajan por Queues con un esquema definido en `packages/contracts`: `TripRequested`, `TripAccepted`, `TripStatusChanged`, `TripCompleted`, `TripRated`, `DriverApproved`, `SosTriggered`, `WalletLow`. Un fallo en un consumidor nunca bloquea la confirmación del viaje.

## 4. Stack tecnológico

Todo el sistema usa TypeScript en modo estricto y comparte tipos a través de `packages/contracts`.

| Capa | Tecnología | Notas |
| --- | --- | --- |
| Lenguaje | TypeScript 5.x | Node.js 20+ solo para herramientas y CI |
| Gestor de paquetes | pnpm workspaces | Un lockfile para todo el repo |
| API HTTP | Hono + `@hono/zod-openapi` | Genera `openapi.json` desde los esquemas Zod |
| Tiempo real | Durable Objects + WebSocket Hibernation API | Sin Socket.io |
| ORM y migraciones | Drizzle ORM + drizzle-kit | Tipos PostGIS mediante columnas personalizadas |
| Base de datos | Neon Postgres + PostGIS | Driver `@neondatabase/serverless` |
| Almacenamiento | R2 | Fotos de documentos de conductores, imágenes de destinos |
| Caché y límites | KV + rate limiting de Workers | OTP, bloqueo de intentos |
| Colas | Cloudflare Queues | Eventos de dominio |
| JWT | `jose` (RS256) | Access 15 min, refresh 30 días con rotación |
| Web | Next.js + `@opennextjs/cloudflare`, Tailwind CSS, TanStack Query | Portal público con SEO y paneles privados |
| Móvil | Expo (React Native) + Expo Router, `@maplibre/maplibre-react-native` | Requiere build nativa (no Expo Go) |
| Datos offline (móvil) | `expo-sqlite` | Cola de GPS y acciones sin red |
| Mapas | MapLibre + Protomaps (`.pmtiles` en R2) | Estilo propio |
| Rutas | OpenRouteService (plan Standard gratuito) | Llamado solo desde `api-core` |
| Correo | Resend (principal) + Brevo (respaldo) | Ver sección 7 |
| Push | Expo Push Notifications | Gratuito |
| Pruebas | Vitest, `@cloudflare/vitest-plugin`, Playwright (web) |  |
| Calidad | ESLint, Prettier |  |
| Errores | Sentry (plan gratuito) | API, web y app |

## 5. Identidad, roles y navegación

Cada persona tiene una sola cuenta con uno o varios roles y un modo activo. Un conductor que se queda sin vehículo sigue usando la misma cuenta como pasajero.

### 5.1. Modelo de datos

```
users            (id, email, phone, full_name, status, created_at)
user_roles       (user_id, role, granted_at, granted_by)
driver_profiles  (user_id, vehicle_type, plate, verification_status,
                  availability, wallet_balance, rating_avg)
driver_documents (id, user_id, type, r2_key, status, reviewed_by, reviewed_at)
ratings          (trip_id, from_user, to_user, as_role, stars, tags)
```

### 5.2. Roles

| Rol | Canal | Pantalla inicial |
| --- | --- | --- |
| PASSENGER | App y web pública | Mapa para pedir viaje |
| DRIVER | App | Disponibilidad y ofertas entrantes |
| ADMIN | Web | Dashboard: flota, aprobaciones, tarifas, reportes |
| DISPATCHER | Web | Consola de despacho y alertas SOS |
| TOUR\_OPERATOR | Web | Circuitos, cupos, guías y reservas |

### 5.3. Reglas

- Todo usuario nace con el rol PASSENGER.
- DRIVER se solicita desde la app y se otorga solo cuando un ADMIN aprueba los documentos. Mientras tanto, la app muestra el onboarding.
- El JWT incluye `roles[]` y `activeMode` (`passenger` o `driver`). Cambiar de modo emite un token nuevo.
- Al pasar a modo pasajero, el conductor queda automáticamente no disponible.
- No se puede cambiar de modo con un viaje en curso.
- Un conductor suspendido, sin saldo o sin vehículo conserva su acceso como pasajero.
- Las calificaciones se separan por rol (`as_role`).
- Los roles ADMIN, DISPATCHER y TOUR\_OPERATOR solo operan en la web y usan cuentas de personal separadas.
- La autorización se valida siempre en la API con `requireRole()` y `requireMode()`; la navegación del cliente es solo experiencia de usuario.

### 5.4. Navegación

En la app, el layout raíz de Expo Router lee la sesión y redirige: sin sesión a `(auth)`; modo conductor sin aprobar a `(onboarding)`; modo conductor aprobado a `(driver)`; en cualquier otro caso a `(passenger)`. Un usuario solo con roles de personal ve un aviso que lo dirige a la web.

En la web, el `middleware.ts` de Next.js decodifica el token de la cookie y redirige a `/admin`, `/despacho` u `/operador` según el rol. El portal público no requiere sesión.

## 6. Mapas, rutas y seguimiento en tiempo real

El mapa base se sirve desde la propia infraestructura y la ruta se calcula pocas veces por viaje. El movimiento en vivo viaja por WebSocket sin consumir APIs externas.

### 6.1. Mapa base

- Extracto de OpenStreetMap (Protomaps) que cubre Villagarzón, Mocoa y el corredor a Puerto Asís, en un archivo `.pmtiles` alojado en R2 y servido por `api-core`.
- Estilo propio con paleta limitada, etiquetas grandes y alto contraste.
- Puntos clave siempre visibles con ícono propio: Aeropuerto Cananguchal, parque principal, Pozo Azul, Río Guineo, Cascadas de Vica y Mohano.
- Marcadores por tipo de vehículo: mototaxi, taxi y 4x4.
- Modo oscuro automático desde las 8:00 p. m., alineado con el recargo nocturno.
- El conductor puede guardar el archivo en el teléfono para usar el mapa sin señal.

### 6.2. Rutas (OpenRouteService)

El plan Standard gratuito permite 2.000 consultas de direcciones al día y 40 por minuto ([planes de openrouteservice](https://openrouteservice.org/plans/)). Para no agotarlo:

1. Al aceptar el viaje se calculan dos rutas: conductor → recogida y recogida → destino. Las polilíneas se guardan en el viaje.
2. La estimación de tarifa reutiliza la ruta recogida → destino, guardada en caché durante 10 minutos.
3. El tiempo estimado de llegada se calcula en el cliente con la distancia restante sobre la polilínea.
4. Solo se recalcula si el conductor se desvía más de 50 m de la ruta durante 3 lecturas seguidas.

Son unas 3–4 consultas por viaje. La clave de la API vive solo en el Worker, nunca en la app.

### 6.3. Flujo en vivo

1. La app del conductor envía su posición a `DriverTracker` cada 1,5 s en movimiento y cada 10 s detenido.
2. `DriverTracker` actualiza `ZoneIndex` y, si hay viaje activo, reenvía la posición a `TripRoom`.
3. `TripRoom` difunde la posición al pasajero y a `OpsHub`.
4. El pasajero ve el vehículo moverse con interpolación suave sobre la línea de la ruta; el conductor ve al pasajero y su ruta.
5. Sin señal, la app del conductor encola posiciones en SQLite y las envía en lote al reconectar.

La cobertura de OSM en veredas puede estar incompleta. Durante las pruebas de campo se registrarán en OSM las vías faltantes hacia los destinos turísticos.

## 7. Autenticación y correo OTP

El inicio de sesión es por código de 6 dígitos enviado al correo. Sin dominio propio, el correo no puede autenticarse con SPF/DKIM/DMARC, así que en la etapa de pruebas se usa un esquema mixto y se migra al comprar el dominio.

### 7.1. Restricción actual

Los subdominios `*.workers.dev` no permiten crear registros DNS propios, por lo que no sirven para verificar un remitente en Resend ni en Brevo. Cloudflare Email Sending requiere el plan Workers Paid ([precios](https://developers.cloudflare.com/email-service/platform/pricing/)).

### 7.2. Etapa de pruebas (sin dominio)

- **Brevo con remitente verificado:** se verifica un correo personal (por ejemplo, una cuenta Gmail del proyecto) como remitente. Funciona hacia cualquier destinatario, pero puede caer en spam o Promociones. A los testers se les pide marcar el primer correo como "No es spam" y agregar el remitente a contactos.
- **Modo `OTP_DEV_ECHO` (solo staging):** para correos en una lista blanca de testers, la API también registra el código en los logs del Worker. Nunca se activa en producción.
- Las cuotas gratuitas son de 300 correos al día en Brevo y 100 al día en Resend.

### 7.3. Con dominio propio (fase posterior)

1. Comprar el dominio en Cloudflare Registrar y usar el subdominio de envío `mail.<dominio>`.
2. Configurar SPF, DKIM y DMARC en Cloudflare DNS con los registros que entregan Resend y Brevo.
3. Resend como proveedor principal y Brevo como respaldo automático al alcanzar el límite diario, detrás de una interfaz `EmailSender`.
4. Registrar el dominio en Google Postmaster Tools.

### 7.4. Reglas del OTP

- Código de 6 dígitos, vigencia de 5 minutos, guardado como hash en KV.
- Máximo 3 códigos por correo cada 15 minutos y 5 intentos de verificación por código.
- Correo corto: remitente fijo, asunto "Tu código PANTER es 123456", versión en texto plano, sin enlaces acortados.
- Tras verificar se emite un access token RS256 de 15 minutos y un refresh token de 30 días con rotación y revocación en KV.
- Las cuentas de personal (web) usan el mismo OTP; las contraseñas quedan fuera de alcance.
- El teléfono se captura en el perfil sin verificar; la verificación por SMS/WhatsApp pasa a la Fase 3.

## 8. Requerimientos funcionales

Se conservan los 13 requerimientos de la v1.0 con los ajustes indicados, y se añaden RF-14 a RF-16.

| Código | Módulo | Descripción y criterio de aceptación | Prioridad | Fase |
| --- | --- | --- | --- | --- |
| RF-01 | Autenticación | **Cambia:** registro e inicio de sesión por OTP de 6 dígitos enviado al correo (sección 7). | Must | 1 |
| RF-02 | Onboarding conductor | Carga de cédula, licencia, tarjeta de propiedad, SOAT y tecnomecánica a R2. Activación solo tras aprobación de un ADMIN. | Must | 1 |
| RF-03 | Rastreo en tiempo real | **Cambia:** GPS cada 1,5 s en movimiento y cada 10 s detenido, en estado Disponible o En viaje; interpolación suave en el mapa del pasajero. | Must | 1 |
| RF-04 | Despacho y asignación | Radio inicial de 2 km; oferta de 15 s; si se rechaza o expira, pasa al siguiente más cercano; ampliación del radio tras agotar candidatos. | Must | 1 |
| RF-05 | Motor de tarifas | Base $3.000 mototaxi / $6.000 taxi, recargo nocturno desde las 8:00 p. m., recargo aeroportuario de $5.000; valores editables por ADMIN. | Must | 1 |
| RF-06 | Estados del viaje | Solicitado → Aceptado → En camino → En sitio → En curso → Finalizado → Calificado, más Cancelado; timestamp y ubicación en cada transición. | Must | 1 |
| RF-07 | Ecoturismo | Catálogo de destinos y cotización/reserva de 4x4 por ida, ida y vuelta o jornada. | Must | 2 |
| RF-08 | Reserva programada | Programación con hasta 7 días de antelación. | Should | 2 |
| RF-09 | Pagos | **Cambia:** Fase 1 solo efectivo con cálculo de cambio; Nequi, Daviplata y PSE (Wompi) pasan a Fase 2. | Must | 1–2 |
| RF-10 | Billetera de conductor | Comisión del 10 % descontada al finalizar; con saldo menor a $5.000 el conductor no recibe viajes en efectivo. Recargas manuales registradas por ADMIN en Fase 1. | Must | 1 |
| RF-11 | Botón SOS | **Cambia:** alerta crítica en la consola web y enlace de seguimiento compartible por WhatsApp (sin SMS automático en Fase 1). | Must | 1 |
| RF-12 | Calificaciones | Evaluación mutua de 1 a 5 estrellas; etiquetas obligatorias bajo 3 estrellas; separadas por rol. | Must | 1 |
| RF-13 | Panel administrativo | Flota en vivo, aprobación y suspensión de conductores, edición de tarifas y exportación CSV. | Must | 1 |
| RF-14 | Multirol y modo activo | **Nuevo:** una cuenta con varios roles y cambio entre modo pasajero y conductor (sección 5). | Must | 1 |
| RF-15 | Navegación por rol | **Nuevo:** app y web llevan a cada usuario a la pantalla de su rol y modo. | Must | 1 |
| RF-16 | Distribución de la app | **Nuevo:** APK firmada con llave fija, publicada en GitHub Releases por versión; la app avisa cuando hay una versión nueva. | Must | 1 |

## 9. Requerimientos no funcionales

Las metas se ajustan a un piloto en capa gratuita. Las de la v1.0 (1.000 usuarios concurrentes, 99,9 % de disponibilidad) se retoman al pasar a planes pagados.

| Categoría | Meta v1.1 | Mecanismo |
| --- | --- | --- |
| Rendimiento | Posición GPS visible para el pasajero en menos de 500 ms; endpoints REST p95 < 300 ms con Neon activo | WebSockets en Durable Objects, índices GIST, consultas acotadas |
| Arranque en frío | Primera consulta tras inactividad < 2 s | Neon se suspende tras inactividad; se acepta en pruebas |
| Escala del piloto | Hasta 30 conductores y 200 viajes diarios | Ajuste de frecuencia de GPS; monitoreo de cuotas |
| Seguridad | TLS (Cloudflare), JWT RS256 de 15 min, refresh con rotación, documentos en R2 privados con URLs firmadas | Ley 1581 de 2012 (Habeas Data): consentimiento y aviso de privacidad en el registro |
| Offline | La app del conductor encola GPS y cambios de estado sin red y sincroniza al reconectar | `expo-sqlite` + reintentos idempotentes |
| Batería | ≤ 12 % por hora de rastreo en segundo plano | GPS adaptativo: 1,5 s en movimiento, 10 s detenido |
| Observabilidad | Todo error con `tripId` y `userId` | Workers Logs + Sentry |
| Disponibilidad | Sin meta formal en pruebas | Infraestructura administrada de Cloudflare y Neon |

## 10. Ambientes, despliegue y CI/CD

Todo el despliegue lo hace GitHub Actions con `wrangler`, filtrado por carpeta. Cada servicio se despliega solo cuando cambian sus archivos o `packages/contracts`.

### 10.1. Ambientes

| Ambiente | Rama | Neon | Cloudflare | URL |
| --- | --- | --- | --- | --- |
| Local | cualquiera | Rama personal `dev-<nombre>` | `wrangler dev` | localhost |
| Staging | `develop` | Rama `staging` | `--env staging` | `panter-api-staging.<cuenta>.workers.dev` |
| Producción | `main` | Rama `main` | `--env production` | `panter-api.<cuenta>.workers.dev` |

### 10.2. Workflows

| Workflow | Disparador | Pasos |
| --- | --- | --- |
| `ci.yml` | Todo PR | Instalar con pnpm, lint, typecheck y pruebas solo de los paquetes afectados |
| `api-core.yml` | Push a `develop`/`main` con cambios en `api/core/**` o `packages/**` | Migraciones Drizzle en la rama Neon → `wrangler deploy --env <ambiente>` |
| `api-realtime.yml` | Igual, con `api/realtime/**` | `wrangler deploy` (incluye migraciones de Durable Objects) |
| `web.yml` | Igual, con `web/**` | Build OpenNext → `wrangler deploy` |
| `app.yml` | Tag `app-v*` (ej. `app-v0.3.0`) | `expo prebuild` → Gradle `assembleRelease` firmado → APK adjunta a un GitHub Release con changelog |
| `app-preview.yml` | Push a `develop` con cambios en `app/**` | APK de staging como artefacto de la ejecución (apunta a la API de staging) |

### 10.3. Versionado y firma de la APK

- `versionName` sale del tag y `versionCode` del número de ejecución del workflow, siempre creciente.
- El keystore se genera una sola vez y vive en los Secrets de GitHub (`ANDROID_KEYSTORE_BASE64`, contraseñas y alias). Si la llave cambia, Android no permite instalar la actualización encima.
- La app consulta al iniciar el último Release publicado y muestra un aviso con el enlace de descarga si hay versión nueva.

### 10.4. Secretos

CLOUDFLARE\_API\_TOKEN, CLOUDFLARE\_ACCOUNT\_ID, DATABASE\_URL por ambiente, claves JWT (privada y pública), BREVO\_API\_KEY, RESEND\_API\_KEY, ORS\_API\_KEY, SENTRY\_DSN y los secretos del keystore. En los Workers se cargan con `wrangler secret put`, nunca en el repositorio.

## 11. Hoja de ruta y backlog

La Fase 1 (MVP urbano) se organiza en 12 épicas y 64 historias, repartidas en 7 hitos de unas 16 semanas. Cada historia es un issue de GitHub con criterios de aceptación, área (`api`, `web`, `app`, `infra`, `contracts`) y dependencias, para que pueda tomarla un agente o una persona sin contexto adicional.

### 11.1. Hitos y orden de implementación

| Hito | Sprint | Épicas | Resultado verificable |
| --- | --- | --- | --- |
| M0 Fundaciones | 0 | E0 | Los tres servicios desplegados en staging con healthcheck; APK de prueba en Releases |
| M1 Identidad | 1 | E1 | Login OTP en app y web; cada rol llega a su pantalla |
| M2 Conductores, mapas y tarifas | 2–3 | E2, E3, E4 | Conductor aprobado por admin; mapa propio en app y web; estimado de tarifa |
| M3 Tiempo real | 4 | E5 | Flota en vivo en la consola web |
| M4 Viajes | 5–6 | E6 | Viaje completo de punta a punta con matching de 15 s |
| M5 Cobro, seguridad y reputación | 7 | E7, E8, E9, E10 | Comisión descontada, SOS en consola, calificaciones |
| M6 Piloto | 8 | E11 | Prueba de campo en Villagarzón y v1.0.0 de la APK |

### 11.2. Épicas de la Fase 1

| Épica | Nombre | Hito | Historias |
| --- | --- | --- | --- |
| E0 | Fundaciones del repositorio y despliegue | M0 | 8 |
| E1 | Identidad, roles y navegación | M1 | 9 |
| E2 | Onboarding de conductores | M2 | 5 |
| E3 | Mapas y geodatos | M2 | 6 |
| E4 | Motor de tarifas | M2 | 4 |
| E5 | Rastreo en tiempo real | M3 | 4 |
| E6 | Viajes y despacho | M4 | 9 |
| E7 | Efectivo y billetera del conductor | M5 | 5 |
| E8 | Seguridad y SOS | M5 | 4 |
| E9 | Calificaciones | M5 | 2 |
| E10 | Notificaciones y operación | M5 | 4 |
| E11 | Piloto y pruebas de campo | M6 | 4 |

Las épicas de la Fase 2 (E12 Portal ecoturístico y reservas 4x4, E13 Reservas programadas, E14 Pagos digitales Nequi/Daviplata/PSE) se crean como issues sin historias; se detallan al cerrar M6.

### 11.3. Trabajo en paralelo

Dentro de cada hito, las historias de `contracts` y `api` que definen esquemas van primero. En cuanto el esquema está en `packages/contracts`, las historias de `web` y `app` avanzan en paralelo con datos simulados. Cada historia declara sus dependencias en el campo "Depende de", y una historia solo se inicia cuando sus dependencias están cerradas.

### 11.4. Convenciones de los issues

- Etiquetas: `tipo:epica` o `tipo:historia`, `area:*`, `fase:1`, `prioridad:alta|media|baja`.
- Hito de GitHub = M0 a M6.
- Título de historia: `[HU-xxx] <frase>`; cuerpo con historia de usuario, criterios de aceptación en casillas, notas técnicas y dependencias.
- Cada épica lista sus historias como casillas enlazadas.
- Rama: `feature/<número-issue>-<slug>`; PR con `Closes #<número>`.

El backlog completo está en `Docs/BACKLOG.md` y se carga como issues con `scripts/crear_issues.sh` (GitHub CLI). El script es idempotente: no duplica issues que ya existen.

## 12. Riesgos y límites de la capa gratuita

El mayor riesgo técnico de la v1.1 es que el correo OTP caiga en spam sin dominio propio; el segundo, agotar cuotas gratuitas con el GPS en vivo.

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| OTP en spam sin dominio | Alto | Brevo con remitente verificado, instrucciones a testers, `OTP_DEV_ECHO` en staging; comprar dominio antes del piloto abierto |
| Cuotas de Workers y Durable Objects con GPS cada 1,5 s | Medio-alto | GPS adaptativo, WebSocket Hibernation, monitoreo diario; pasar a Workers Paid (USD 5/mes) si se supera |
| Cuota de OpenRouteService (2.000 rutas/día) | Medio | 3–4 consultas por viaje, caché, recálculo solo por desvío |
| Arranque en frío de Neon | Bajo | Aceptado en pruebas; plan pagado o compute siempre activo en producción |
| Almacenamiento de Neon (0,5 GB) | Medio | No guardar cada punto GPS en Postgres: solo la ruta simplificada por viaje |
| Cobertura OSM incompleta en veredas | Medio | Mapeo propio en OSM durante pruebas de campo |
| Conectividad rural | Alto | Cola offline en SQLite y mapa descargado en el teléfono |
| APK fuera de tiendas | Medio | Llave de firma fija, aviso de actualización en la app, instrucciones de instalación |
| Regulación de transporte y Habeas Data | Alto | Consentimiento explícito, aviso de privacidad, revisión legal antes del lanzamiento público |
| Un solo desarrollador | Medio | Historias pequeñas con criterios claros, CI estricto, documentación en ADR |

Los límites de los planes gratuitos cambian con frecuencia; se revisan al inicio de cada hito en la documentación oficial de cada proveedor.
