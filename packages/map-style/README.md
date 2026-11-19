# @panter/map-style

Estilo MapLibre de PANTER (HU-302), compartido por la web (`maplibre-gl`, HU-304) y la app
(`@maplibre/maplibre-react-native`, HU-303). TypeScript puro: sin React, DOM ni canvas.

- **Mapa base** propio servido por `panter-api` (HU-301): `.pmtiles`, glifos y sprites en R2.
- **Capas** de [`@protomaps/basemaps`](https://github.com/protomaps/basemaps) 5.7.2 (versión
  fijada, sin peerDependencies) con una **paleta limitada** de PANTER: verde selva, ríos azules
  y vías blancas de alto contraste con la troncal en ámbar (`src/palette.ts`).
- **Etiquetas en español** (`name:es`, con `name` de respaldo) un 25 % más grandes.
- **Puntos clave** siempre visibles con ícono propio: Aeropuerto Cananguchal, parque principal,
  Pozo Azul, Río Guineo, Cascadas de Vica y Mohano (`src/places.ts`).
- **Íconos** propios de lugares y de vehículos (mototaxi, taxi, 4x4) como SVG, RGBA y PNG.
- **Tema oscuro** automático desde las 8:00 p. m. hasta las 5:00 a. m., hora de Colombia, igual
  que el recargo nocturno por defecto.

> ⚠️ **Coordenadas por verificar (HU-1102).** Solo la del aeropuerto es una coordenada
> publicada. El parque principal usa el centro urbano, y Pozo Azul, Río Guineo, Cascadas de
> Vica y Mohano son **estimaciones** (`approximate: true`, con `uncertaintyMeters` de 5–8 km)
> para que el punto aparezca en la zona. Hay que tomarlas con GPS en la prueba de campo y
> cotejarlas con OpenStreetMap antes de usarlas para geocercas, tarifas o navegación.

## Uso

```ts
import {
  ALL_ICON_IDS,
  iconImage,
  iconPngDataUrl,
  basemapUrls,
  buildStyle,
  parseBasemapManifest,
  SERVICE_AREA_BOUNDS,
  themeFor,
} from '@panter/map-style';

// 1. Archivo vigente del mapa (cambia cuando se regenera; caché de 5 min).
const manifest = parseBasemapManifest(await (await fetch(`${API_URL}/tiles/basemap.json`)).json());

// 2. Estilo del tema de la hora actual en Colombia.
const style = buildStyle({ ...basemapUrls(API_URL, manifest), theme: themeFor(new Date()) });
```

`buildStyle({ tilesUrl, glyphsUrl, spriteUrl, theme })`:

| Opción      | Valor                                                                     |
| ----------- | ------------------------------------------------------------------------- |
| `tilesUrl`  | `https://<api>/tiles/panter-AAAAMMDD.pmtiles`, o `pmtiles://…` ya formada |
| `glyphsUrl` | `https://<api>/tiles/fonts/{fontstack}/{range}.pbf`                       |
| `spriteUrl` | `https://<api>/tiles/sprites/v4` (se le agrega `/light` o `/dark`)        |
| `theme`     | `'light'` o `'dark'`                                                      |

La fuente vectorial usa el protocolo `pmtiles://`, así que el cliente debe registrarlo.

### Web (maplibre-gl, HU-304)

```ts
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

maplibregl.addProtocol('pmtiles', new Protocol().tile);
const map = new maplibregl.Map({ container, style, maxBounds: SERVICE_AREA_BOUNDS });
map.on('load', () => {
  for (const id of ALL_ICON_IDS) {
    if (!map.hasImage(id)) map.addImage(id, iconImage(id, 2), { pixelRatio: 2 });
  }
});
// Al cambiar de tema: map.setStyle(buildStyle({ ...urls, theme })) y volver a registrar íconos.
```

`iconImage(id, pixelRatio)` devuelve `{ width, height, data }` RGBA, el formato que acepta
`addImage` sin canvas. Para un marcador HTML sirve `iconSvgDataUrl(id)` o `iconSvg(id)`.

### App (maplibre-react-native, HU-303)

```tsx
const images = Object.fromEntries(ALL_ICON_IDS.map((id) => [id, { uri: iconPngDataUrl(id, 3) }]));
<MapView mapStyle={style}>
  <Images images={images} />
</MapView>;
```

Para usar el mapa sin señal, el conductor descarga `panter-AAAAMMDD.pmtiles` y se pasa como
`tilesUrl: 'pmtiles://file:///…/panter-AAAAMMDD.pmtiles'`. Los glifos y sprites también están
en `/tiles` para guardarlos junto al archivo.

### Marcadores de vehículos

`VEHICLE_ICON[vehicleType]` da el id del ícono (`vehicle-mototaxi`, `vehicle-taxi`,
`vehicle-4x4`) para cada `VehicleType` de `@panter/contracts`. Úsalo como `icon-image` en la
capa de conductores de cada cliente.

### Tema

`themeFor(date, night?)` calcula la hora en Colombia (UTC−5, sin horario de verano), sin importar
la zona del dispositivo. `'dark'` desde las 20:00:00 (incluida) hasta antes de las 05:00:00.
Si la tarifa vigente define otro horario nocturno, pásalo: `themeFor(now, { startMinute:
rule.nightStartMinute, endMinute: rule.nightEndMinute })`.

## Pruebas

`pnpm --filter @panter/map-style test`: valida los dos temas con `validateStyleMin` de
`@maplibre/maplibre-gl-style-spec`, las fuentes que pide el estilo (deben estar en R2), la
paleta, los puntos clave, los íconos (SVG, RGBA y PNG) y los límites del tema (19:59, 20:00,
04:59, 05:00).
