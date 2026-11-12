# Backlog PANTER — Fase 1

Orden de implementación: por hito (M0→M6) y, dentro de cada hito, respetando 'Depende de'.

## E0 · Fundaciones del repositorio y despliegue (M0 Fundaciones)

Monorepo, esqueletos de api/web/app, base de datos y pipelines. Sección 2 y 10 de la especificación v1.1.

### HU-001 · Monorepo pnpm con packages/contracts
Área: infra · Prioridad: alta · Depende de: ninguna

Como desarrollador quiero un monorepo con pnpm workspaces para compartir tipos sin acoplar los despliegues.

- [ ] Existe pnpm-workspace.yaml con api/core, api/realtime, web, app y packages/contracts
- [ ] tsconfig base estricto, ESLint y Prettier compartidos
- [ ] packages/contracts exporta enums Role, ActiveMode, TripStatus, VehicleType y compila
- [ ] README raíz con comandos de desarrollo

Notas: Node 20+, TypeScript 5.x. Sin dependencias entre apps salvo contracts.

### HU-002 · Esqueleto de api/core con Hono y entornos de Wrangler
Área: api · Prioridad: alta · Depende de: HU-001

Como desarrollador quiero el Worker api-core funcionando en staging y producción para construir sobre él.

- [ ] wrangler.toml con env staging y production
- [ ] GET /health responde versión y commit
- [ ] @hono/zod-openapi configurado y GET /openapi.json disponible
- [ ] Middleware de errores con formato JSON uniforme
- [ ] Pruebas con @cloudflare/vitest-pool-workers

Notas: Bindings declarados aunque vacíos: KV, R2, Queues, service binding a realtime.

### HU-003 · Esqueleto de api/realtime con Durable Objects
Área: api · Prioridad: alta · Depende de: HU-001

Como desarrollador quiero el Worker de tiempo real con un Durable Object de ejemplo y conexión desde api-core.

- [ ] Worker panter-realtime desplegable por entorno
- [ ] Clases DriverTracker, ZoneIndex, TripRoom y OpsHub registradas (vacías) con migración de DO
- [ ] api-core llama a realtime por Service Binding y /health lo refleja
- [ ] Ejemplo de WebSocket con Hibernation API probado

### HU-004 · Base de datos Neon con PostGIS y Drizzle
Área: infra · Prioridad: alta · Depende de: HU-002

Como desarrollador quiero la base de datos con ramas por ambiente y migraciones versionadas.

- [ ] Proyecto Neon con ramas main y staging
- [ ] Extensión postgis habilitada por migración
- [ ] Drizzle + drizzle-kit configurados en api/core con tipo geography(Point,4326)
- [ ] Migración inicial: users, user_roles
- [ ] Script pnpm db:migrate usado por CI

Notas: Driver @neondatabase/serverless. DATABASE_URL como secreto por entorno.

### HU-005 · Esqueleto web Next.js en Cloudflare (OpenNext)
Área: web · Prioridad: alta · Depende de: HU-001

Como desarrollador quiero la web desplegada en Cloudflare para avanzar en portal y paneles.

- [ ] Next.js + Tailwind + TanStack Query
- [ ] @opennextjs/cloudflare configurado; despliegue a panter-web-staging
- [ ] Grupos de rutas: (public), (auth), admin, despacho, operador con páginas placeholder
- [ ] Cliente HTTP tipado con contracts y variable de URL de API por entorno

### HU-006 · Esqueleto app Expo con Expo Router
Área: app · Prioridad: alta · Depende de: HU-001

Como desarrollador quiero la app base con grupos de rutas por rol y build nativa.

- [ ] Expo + TypeScript + Expo Router
- [ ] Grupos (auth), (passenger), (driver), (onboarding) con pantallas placeholder
- [ ] expo prebuild genera proyecto Android que compila
- [ ] Variables de entorno de API por perfil (staging, production)

Notas: MapLibre RN no corre en Expo Go: usar development build.

### HU-007 · CI y despliegue automático a staging
Área: infra · Prioridad: alta · Depende de: HU-002, HU-003, HU-004, HU-005

Como desarrollador quiero que cada PR se valide y cada merge a develop se despliegue a staging.

- [ ] ci.yml: lint, typecheck y pruebas de los paquetes afectados en cada PR
- [ ] api-core.yml, api-realtime.yml, web.yml con filtros por ruta
- [ ] Push a develop → staging; push a main → production
- [ ] Migraciones Drizzle antes del deploy de api-core
- [ ] Protección de ramas develop y main: CI obligatorio

Notas: Crear la rama develop desde main si aún no existe.

### HU-008 · APK firmada y versionada en GitHub Releases
Área: infra · Prioridad: alta · Depende de: HU-006

Como responsable quiero generar APKs instalables por versión sin Play Store.

- [ ] Keystore generado una vez y guardado en Secrets
- [ ] app.yml se dispara con tags app-v*; versionName del tag, versionCode del run
- [ ] Release con APK adjunta y changelog de Conventional Commits
- [ ] app-preview.yml genera APK de staging como artefacto en push a develop
- [ ] Instrucciones de instalación en el README

Notas: Gradle assembleRelease tras expo prebuild en ubuntu-latest con JDK 17.

## E1 · Identidad, roles y navegación (M1 Identidad)

OTP por correo, JWT, multirol con modo activo y navegación por rol en app y web. Secciones 5 y 7.

### HU-101 · Registro e inicio de sesión con código al correo
Área: api · Prioridad: alta · Depende de: HU-004

Como usuario quiero ingresar con un código enviado a mi correo para no manejar contraseñas.

- [ ] POST /auth/otp/request genera código de 6 dígitos con hash en KV y vigencia de 5 min
- [ ] Límite: 3 códigos por correo cada 15 min; 5 intentos por código
- [ ] POST /auth/otp/verify crea el usuario con rol PASSENGER si no existe
- [ ] Respuestas no revelan si el correo ya existe

### HU-102 · Servicio de envío de correo (EmailSender)
Área: api · Prioridad: alta · Depende de: HU-002

Como sistema quiero enviar el OTP con un proveedor gratuito y poder cambiarlo sin tocar el resto.

- [ ] Interfaz EmailSender con implementación Brevo (remitente verificado)
- [ ] Implementación Resend lista para cuando haya dominio, con respaldo automático
- [ ] Modo OTP_DEV_ECHO solo en staging y solo para correos en lista blanca
- [ ] Plantilla con versión texto plano y asunto 'Tu código PANTER es XXXXXX'

### HU-103 · Tokens JWT de acceso y refresco
Área: api · Prioridad: alta · Depende de: HU-101

Como usuario quiero que mi sesión se mantenga segura sin volver a ingresar a cada rato.

- [ ] Access token RS256 de 15 min con sub, roles[], activeMode
- [ ] Refresh token de 30 días con rotación y revocación en KV
- [ ] POST /auth/refresh y POST /auth/logout
- [ ] Claves en secretos de Wrangler

Notas: Librería jose.

### HU-104 · Multirol y control de acceso (RBAC)
Área: api · Prioridad: alta · Depende de: HU-103

Como sistema quiero autorizar cada endpoint según rol y modo activo.

- [ ] Middlewares requireRole() y requireMode()
- [ ] POST /me/mode cambia de modo y emite token nuevo; falla con viaje en curso
- [ ] Al pasar a passenger el conductor queda no disponible
- [ ] GET /me devuelve perfil, roles y modo
- [ ] Pruebas con cobertura ≥ 80 %

Notas: En M1 aún no existen trips (HU-601) ni driver_profiles (HU-201). Definir puertos `ActiveTripChecker` y `DriverAvailability` con implementación vacía (sin viaje activo / no-op) y conectarlos de verdad en HU-201 y HU-602.

### HU-105 · Login OTP en la app
Área: app · Prioridad: alta · Depende de: HU-006, HU-103

Como usuario de la app quiero ingresar con mi correo y el código recibido.

- [ ] Pantalla de correo y pantalla de código con reenvío tras 60 s
- [ ] Sesión en SecureStore y refresco automático del token
- [ ] Manejo de errores: código vencido, límite alcanzado, sin red

### HU-106 · Navegación por rol y selector de modo en la app
Área: app · Prioridad: alta · Depende de: HU-104, HU-105

Como usuario con varios roles quiero cambiar entre modo pasajero y conductor y ver mis pantallas.

- [ ] Layout raíz redirige a (auth), (onboarding), (driver) o (passenger)
- [ ] Selector de modo visible solo si el usuario tiene DRIVER
- [ ] Cambio bloqueado con viaje en curso, con mensaje claro
- [ ] Usuarios solo de personal ven aviso que los dirige a la web

Notas: El bloqueo por viaje en curso se resuelve mostrando el código de error que devuelve POST /me/mode (HU-104); no requiere esperar a E6.

### HU-107 · Login y redirección por rol en la web
Área: web · Prioridad: alta · Depende de: HU-005, HU-103

Como personal quiero ingresar a la web y llegar a mi panel.

- [ ] Login OTP en /login
- [ ] Token en cookie httpOnly; middleware.ts redirige a /admin, /despacho u /operador
- [ ] Rutas privadas devuelven 403 si el rol no corresponde
- [ ] Cerrar sesión

### HU-108 · Gestión de usuarios y roles de personal
Área: web · Prioridad: media · Depende de: HU-104, HU-107

Como administrador quiero buscar usuarios y otorgar o retirar roles de personal.

- [ ] Endpoint y pantalla de listado con búsqueda por correo
- [ ] Otorgar/retirar ADMIN, DISPATCHER, TOUR_OPERATOR con registro de quién lo hizo
- [ ] Un administrador no puede quitarse su propio rol ADMIN

### HU-109 · Consentimiento de tratamiento de datos (Ley 1581)
Área: app · Prioridad: alta · Depende de: HU-105

Como usuario quiero conocer y aceptar el tratamiento de mis datos antes de registrarme.

- [ ] Aviso de privacidad visible en app y web
- [ ] Aceptación obligatoria en el primer ingreso, guardada con fecha y versión
- [ ] Si cambia la versión del aviso se solicita de nuevo

Notas: Incluye trabajo de api (tabla user_consents y POST /me/consent; GET /me indica si falta aceptar) y una página pública del aviso en la web.

## E2 · Onboarding de conductores (M2 Conductores, mapas y tarifas)

Solicitud para ser conductor, carga de documentos a R2 y aprobación por administrador (RF-02).

### HU-201 · Solicitar ser conductor
Área: api · Prioridad: alta · Depende de: HU-104

Como pasajero quiero solicitar ser conductor registrando mi vehículo.

- [ ] Tabla driver_profiles con vehicle_type, plate, verification_status
- [ ] POST /drivers/apply crea perfil en estado PENDING
- [ ] No otorga el rol DRIVER hasta la aprobación

### HU-202 · Carga de documentos a R2
Área: api · Prioridad: alta · Depende de: HU-201

Como solicitante quiero subir mis documentos de forma segura.

- [ ] Tipos: cédula, licencia, tarjeta de propiedad, SOAT, tecnomecánica
- [ ] URL firmada de subida con límite de tamaño y tipo de imagen
- [ ] Tabla driver_documents con estado por documento
- [ ] Los archivos nunca son públicos

### HU-203 · Flujo de onboarding en la app
Área: app · Prioridad: alta · Depende de: HU-106, HU-202

Como solicitante quiero completar mi registro de conductor desde el teléfono.

- [ ] Formulario de vehículo y captura con cámara de cada documento
- [ ] Progreso y estado de revisión por documento
- [ ] Reintento de subida sin red

### HU-204 · Revisión y aprobación de conductores
Área: web · Prioridad: alta · Depende de: HU-107, HU-202

Como administrador quiero revisar documentos y aprobar, rechazar o suspender conductores.

- [ ] Listado de solicitudes pendientes
- [ ] Vista de documentos con URL firmada de lectura
- [ ] Aprobar otorga rol DRIVER; rechazar exige motivo; suspender bloquea modo conductor
- [ ] Evento DriverApproved publicado en la cola

### HU-205 · Aviso de resultado al solicitante
Área: app · Prioridad: media · Depende de: HU-203, HU-204

Como solicitante quiero saber cuándo me aprueban o qué debo corregir.

- [ ] Pantalla de onboarding refleja el estado actual
- [ ] Notificación push al aprobar o rechazar (cuando E10 esté lista)

## E3 · Mapas y geodatos (M2 Conductores, mapas y tarifas)

Mapa base propio con Protomaps en R2, estilo claro/oscuro y rutas con OpenRouteService. Sección 6.

### HU-301 · Mapa base de Putumayo servido desde R2
Área: infra · Prioridad: alta · Depende de: HU-002

Como sistema quiero un mapa base propio sin depender de servicios pagos.

- [ ] Extracto .pmtiles de Villagarzón–Mocoa–Puerto Asís generado con script reproducible
- [ ] Archivo en R2 servido por api-core con soporte de rangos y caché
- [ ] Documentado cómo regenerarlo

### HU-302 · Estilo de mapa claro y oscuro con puntos clave
Área: contracts · Prioridad: alta · Depende de: HU-301

Como usuario quiero un mapa claro y fácil de leer, de día y de noche.

- [ ] Estilo MapLibre propio en packages/contracts (o assets compartidos)
- [ ] Íconos para aeropuerto, parque principal y destinos turísticos
- [ ] Marcadores por tipo de vehículo
- [ ] Variante oscura que se activa desde las 8:00 p. m.

### HU-303 · Componente de mapa en la app
Área: app · Prioridad: alta · Depende de: HU-006, HU-302

Como usuario de la app quiero ver el mapa con mi ubicación.

- [ ] @maplibre/maplibre-react-native con el estilo propio
- [ ] Permisos de ubicación y botón de centrar
- [ ] Descarga del mapa para uso sin señal (conductor)

### HU-304 · Componente de mapa en la web
Área: web · Prioridad: alta · Depende de: HU-005, HU-302

Como personal quiero un mapa base en los paneles.

- [ ] maplibre-gl con el mismo estilo
- [ ] Capa de marcadores reutilizable

### HU-305 · Rutas con OpenRouteService
Área: api · Prioridad: alta · Depende de: HU-002

Como sistema quiero calcular rutas sin exponer la clave ni agotar la cuota.

- [ ] GET /routes con origen y destino; clave solo en el Worker
- [ ] Caché de 10 minutos por par redondeado de coordenadas
- [ ] Devuelve polilínea, distancia y duración
- [ ] Contador diario de consultas visible en logs

### HU-306 · Utilidades geográficas compartidas
Área: contracts · Prioridad: alta · Depende de: HU-001

Como desarrollador quiero funciones geográficas probadas y compartidas.

- [ ] Haversine, decodificación de polilíneas, distancia restante sobre ruta
- [ ] Punto en polígono para geocercas
- [ ] Pruebas unitarias con coordenadas reales de Villagarzón

## E4 · Motor de tarifas (M2 Conductores, mapas y tarifas)

Tarifas paramétricas, recargos y geocercas (RF-05).

### HU-401 · Tablas de tarifas y geocercas
Área: api · Prioridad: alta · Depende de: HU-004

Como sistema quiero tarifas configurables y zonas geográficas.

- [ ] Tablas fare_rules y geofences (PostGIS)
- [ ] Semillas: base $3.000 mototaxi, $6.000 taxi, nocturno desde 20:00, aeropuerto +$5.000
- [ ] Geocercas de aeropuerto Cananguchal y zona periférica

### HU-402 · Estimación de tarifa
Área: api · Prioridad: alta · Depende de: HU-305, HU-306, HU-401

Como pasajero quiero conocer el precio antes de pedir.

- [ ] POST /fares/estimate con origen, destino y tipo de vehículo
- [ ] Aplica recargos por hora y geocercas, desglosados en la respuesta
- [ ] Lógica en función pura con cobertura ≥ 80 %

### HU-403 · Edición de tarifas por el administrador
Área: web · Prioridad: media · Depende de: HU-107, HU-401

Como administrador quiero ajustar tarifas sin desplegar código.

- [ ] Pantalla de edición con validación
- [ ] Historial de cambios con autor y fecha

### HU-404 · Estimado en la app
Área: app · Prioridad: alta · Depende de: HU-303, HU-402

Como pasajero quiero ver el precio y la ruta al elegir destino.

- [ ] Búsqueda o selección de destino en el mapa
- [ ] Muestra ruta, distancia, tiempo y precio con desglose

## E5 · Rastreo en tiempo real (M3 Tiempo real)

GPS de conductores, índice por zonas y flota en vivo (RF-03).

### HU-501 · DriverTracker y ZoneIndex
Área: api · Prioridad: alta · Depende de: HU-003, HU-104, HU-306

Como sistema quiero conocer la posición de cada conductor disponible.

- [ ] WebSocket autenticado con JWT en modo driver
- [ ] Última posición por conductor y celdas geohash en ZoneIndex
- [ ] Consulta de conductores disponibles en un radio
- [ ] Conductor sin mensajes por 60 s pasa a desconectado

### HU-502 · Disponibilidad y GPS en segundo plano
Área: app · Prioridad: alta · Depende de: HU-303, HU-501

Como conductor quiero activarme y que mi ubicación se envíe sin tener la app abierta.

- [ ] Interruptor Disponible/No disponible
- [ ] GPS en segundo plano: 1,5 s en movimiento, 10 s detenido
- [ ] Notificación persistente de Android mientras rastrea
- [ ] Bloqueado si el saldo de billetera es insuficiente

Notas: La billetera llega en M5. Aquí basta con mostrar el motivo de bloqueo que devuelva la API; la regla real del saldo se implementa en HU-703.

### HU-503 · Cola offline de posiciones
Área: app · Prioridad: media · Depende de: HU-502

Como conductor en zona sin señal quiero que mi recorrido no se pierda.

- [ ] Posiciones encoladas en expo-sqlite sin red
- [ ] Envío en lote al reconectar, sin duplicados

### HU-504 · Flota en vivo en la consola web
Área: web · Prioridad: alta · Depende de: HU-304, HU-501

Como despachador quiero ver todos los conductores conectados en el mapa.

- [ ] OpsHub difunde posiciones a la web
- [ ] Marcadores por tipo y estado con movimiento suave
- [ ] Filtro por tipo de vehículo y estado

## E6 · Viajes y despacho (M4 Viajes)

Solicitud, matching, estados y seguimiento (RF-04, RF-06).

### HU-601 · Modelo de viajes y máquina de estados
Área: contracts · Prioridad: alta · Depende de: HU-004, HU-306

Como sistema quiero una máquina de estados única para todos los clientes.

- [ ] Estados y transiciones válidas en packages/contracts
- [ ] Tabla trips con ubicaciones geography, polilíneas y timestamps por transición
- [ ] Pruebas de transiciones inválidas, cobertura ≥ 80 %

Notas: Toca contracts (estados y transiciones) y api/core (tabla trips y migración Drizzle).

### HU-602 · Solicitar un viaje
Área: api · Prioridad: alta · Depende de: HU-402, HU-601

Como pasajero quiero pedir un viaje con el precio estimado.

- [ ] POST /trips crea viaje Solicitado y abre TripRoom
- [ ] Un pasajero no puede tener dos viajes activos
- [ ] Evento TripRequested

### HU-603 · Matching con ofertas de 15 segundos
Área: api · Prioridad: alta · Depende de: HU-501, HU-602

Como sistema quiero asignar al conductor más cercano de forma justa.

- [ ] Busca en ZoneIndex dentro de 2 km, ordenados por distancia
- [ ] Oferta a un conductor a la vez con alarm() de 15 s
- [ ] Rechazo o vencimiento pasa al siguiente; amplía radio al agotar
- [ ] Sin conductores: viaje cancelado con motivo y aviso al pasajero

### HU-604 · Recibir y aceptar ofertas
Área: app · Prioridad: alta · Depende de: HU-502, HU-603

Como conductor quiero ver la oferta con cuenta regresiva y decidir.

- [ ] Pantalla de oferta con origen, destino, precio y distancia
- [ ] Cuenta regresiva de 15 s, sonido y vibración
- [ ] Aceptar o rechazar con respuesta inmediata del servidor

### HU-605 · Seguimiento en vivo para el pasajero
Área: app · Prioridad: alta · Depende de: HU-603

Como pasajero quiero ver dónde viene mi conductor y cuánto falta.

- [ ] Vehículo con interpolación suave sobre la ruta
- [ ] ETA calculado en el cliente con la distancia restante
- [ ] Datos del conductor: nombre, placa, calificación
- [ ] Reconexión automática del WebSocket

### HU-606 · Transiciones del viaje por el conductor
Área: app · Prioridad: alta · Depende de: HU-604

Como conductor quiero marcar que llegué, que inicié y que finalicé.

- [ ] Botones según estado: En sitio, Iniciar, Finalizar
- [ ] Cada transición guarda ubicación y hora
- [ ] Funciona sin red encolando la acción
- [ ] Evento TripCompleted al finalizar

### HU-607 · Cancelaciones
Área: api · Prioridad: media · Depende de: HU-602

Como pasajero o conductor quiero poder cancelar con motivo.

- [ ] Reglas de cancelación por estado
- [ ] Motivo obligatorio y registro de quién cancela
- [ ] Libera al conductor y notifica a la otra parte

### HU-608 · Consola de despacho
Área: web · Prioridad: alta · Depende de: HU-504, HU-603

Como despachador quiero ver los viajes activos y asignar manualmente si hace falta.

- [ ] Lista de viajes activos por estado con detalle en mapa
- [ ] Asignación manual a un conductor disponible
- [ ] Creación de viaje telefónico a nombre de un pasajero

### HU-609 · Historial de viajes
Área: app · Prioridad: media · Depende de: HU-606

Como usuario quiero ver mis viajes anteriores.

- [ ] Historial por modo (pasajero/conductor) con paginación
- [ ] Detalle con ruta, precio y calificación

## E7 · Efectivo y billetera del conductor (M5 Cobro, seguridad y reputación)

Pago en efectivo, comisión y bloqueo por saldo (RF-09 Fase 1, RF-10).

### HU-701 · Pago en efectivo con cálculo de cambio
Área: app · Prioridad: alta · Depende de: HU-606

Como conductor quiero registrar el pago en efectivo y saber el cambio.

- [ ] Al finalizar se muestra el valor y se registra el monto recibido
- [ ] Cálculo de cambio en pantalla
- [ ] Pago registrado en la tabla payments

Notas: Requiere en api la tabla payments y el endpoint para registrar el pago del viaje.

### HU-702 · Comisión automática por viaje
Área: api · Prioridad: alta · Depende de: HU-606

Como plataforma quiero descontar el 10 % de cada viaje finalizado.

- [ ] Consumidor de TripCompleted descuenta la comisión en transacción
- [ ] Libro contable wallet_transactions inmutable
- [ ] Idempotente ante eventos repetidos; cobertura ≥ 80 %

### HU-703 · Bloqueo por saldo bajo
Área: api · Prioridad: alta · Depende de: HU-702, HU-603

Como plataforma quiero que un conductor con saldo menor a $5.000 no reciba viajes en efectivo.

- [ ] Evento WalletLow al bajar del umbral
- [ ] El matching excluye conductores bloqueados
- [ ] El conductor ve el motivo en la app

### HU-704 · Recargas registradas por el administrador
Área: web · Prioridad: alta · Depende de: HU-702

Como administrador quiero registrar recargas en efectivo de los conductores.

- [ ] Formulario de recarga con soporte (foto opcional en R2)
- [ ] Historial por conductor
- [ ] Desbloqueo automático al superar el umbral

### HU-705 · Billetera en la app
Área: app · Prioridad: media · Depende de: HU-702

Como conductor quiero ver mi saldo y movimientos.

- [ ] Saldo actual, alerta de saldo bajo y lista de movimientos

## E8 · Seguridad y SOS (M5 Cobro, seguridad y reputación)

Botón de pánico, alerta en consola y enlace de seguimiento (RF-11).

### HU-801 · Botón SOS durante el viaje
Área: app · Prioridad: alta · Depende de: HU-605, HU-606

Como pasajero o conductor quiero pedir ayuda inmediata.

- [ ] Botón visible en viaje con confirmación de 3 s para evitar toques accidentales
- [ ] Envía ubicación y viaje al servidor; evento SosTriggered
- [ ] Funciona aunque la pantalla de viaje se reabra

### HU-802 · Alerta crítica en la consola
Área: web · Prioridad: alta · Depende de: HU-504, HU-801

Como despachador quiero enterarme de inmediato de una emergencia.

- [ ] Alerta sonora y visual prioritaria vía OpsHub
- [ ] Seguimiento en vivo del viaje en alerta
- [ ] Registro de atención con responsable y notas

### HU-803 · Enlace de seguimiento compartible
Área: web · Prioridad: media · Depende de: HU-605

Como pasajero quiero compartir mi viaje en vivo por WhatsApp.

- [ ] Página pública con token que expira al terminar el viaje
- [ ] Muestra solo posición y datos mínimos del vehículo
- [ ] Botón Compartir en la app que abre WhatsApp con el enlace

### HU-804 · Contactos de confianza
Área: app · Prioridad: media · Depende de: HU-801, HU-803

Como usuario quiero registrar hasta 3 contactos para emergencias.

- [ ] CRUD de hasta 3 contactos
- [ ] Al activar SOS la app ofrece enviarles el enlace por WhatsApp

## E9 · Calificaciones (M5 Cobro, seguridad y reputación)

Evaluación mutua separada por rol (RF-12).

### HU-901 · Calificación mutua al finalizar
Área: app · Prioridad: alta · Depende de: HU-606

Como pasajero o conductor quiero calificar a la otra parte.

- [ ] 1 a 5 estrellas; etiquetas obligatorias bajo 3
- [ ] Una calificación por viaje y por parte
- [ ] Viaje pasa a Calificado cuando califica el pasajero

### HU-902 · Promedios por rol
Área: api · Prioridad: media · Depende de: HU-901

Como sistema quiero mantener la reputación por rol.

- [ ] Promedio separado como pasajero y como conductor
- [ ] Visible en datos del conductor y en el panel admin

## E10 · Notificaciones y operación (M5 Cobro, seguridad y reputación)

Push, monitoreo de errores, reportes y actualizaciones de la app.

### HU-1001 · Notificaciones push
Área: api · Prioridad: media · Depende de: HU-603

Como usuario quiero avisos de asignación, llegada y cambios del viaje.

- [ ] Registro de token de Expo Push por dispositivo
- [ ] Consumidor de eventos que envía push
- [ ] Preferencias básicas de notificación

Notas: El registro del token también necesita cambios en la app (permiso de notificaciones y envío del token al iniciar sesión).

### HU-1002 · Monitoreo de errores con Sentry
Área: infra · Prioridad: media · Depende de: HU-007

Como responsable quiero enterarme de errores en api, web y app.

- [ ] Sentry en los tres canales con entorno y versión
- [ ] Errores etiquetados con tripId y userId

### HU-1003 · Reportes exportables
Área: web · Prioridad: media · Depende de: HU-702

Como administrador quiero exportar reportes operativos.

- [ ] CSV de viajes, ingresos por comisión y conductores por rango de fechas

### HU-1004 · Aviso de nueva versión de la app
Área: app · Prioridad: media · Depende de: HU-008

Como usuario quiero saber cuándo descargar una versión nueva.

- [ ] Al iniciar consulta el último Release publicado
- [ ] Aviso con enlace de descarga si la versión instalada es menor

## E11 · Piloto y pruebas de campo (M6 Piloto)

Validación en Villagarzón y versión 1.0.0.

### HU-1101 · Datos semilla y cuentas de prueba
Área: infra · Prioridad: alta · Depende de: HU-608

Como responsable quiero datos de prueba realistas en staging.

- [ ] Script de semillas con usuarios por rol, conductores y tarifas
- [ ] Procedimiento para reiniciar la rama staging de Neon

### HU-1102 · Prueba de campo de GPS y rutas
Área: infra · Prioridad: alta · Depende de: HU-606

Como responsable quiero validar el rastreo y las rutas en las calles de Villagarzón.

- [ ] Recorridos reales con 3+ conductores
- [ ] Error de distancia y geocercas medido (meta < 15 m)
- [ ] Vías faltantes registradas en OpenStreetMap
- [ ] Consumo de batería medido (meta ≤ 12 %/h)

### HU-1103 · Pruebas de carga básicas
Área: api · Prioridad: media · Depende de: HU-603

Como responsable quiero conocer el límite del piloto en capa gratuita.

- [ ] Simulación de 30 conductores y 200 viajes en un día
- [ ] Consumo de cuotas de Workers, DO y ORS documentado

### HU-1104 · Versión 1.0.0 y actualización de la especificación
Área: infra · Prioridad: alta · Depende de: HU-1102, HU-1103

Como responsable quiero cerrar la Fase 1 con una versión estable documentada.

- [ ] Tag app-v1.0.0 y merge a main
- [ ] Especificación actualizada con lo aprendido
- [ ] Épicas de la Fase 2 detalladas en historias

## Fase 2 (épicas sin historias)

- E12 · Portal ecoturístico y reservas 4x4: Catálogo de destinos, cotización y reserva de camperos (RF-07).
- E13 · Reservas programadas: Servicios con hasta 7 días de antelación, incluidos vuelos de VGZ (RF-08).
- E14 · Pagos digitales: Nequi, Daviplata y PSE vía Wompi; recargas de billetera en línea (RF-09).
