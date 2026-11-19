#!/usr/bin/env bash
# Genera el mapa base de PANTER (HU-301): extrae del build diario público de Protomaps la caja
# SERVICE_AREA (Villagarzón, Mocoa y el corredor a Puerto Asís) en un .pmtiles, lo verifica y,
# si se indica un ambiente, lo sube a R2 con wrangler junto con los glifos y sprites del
# estilo (HU-302) y el manifiesto basemap.json.
#
#   scripts/generar_mapa.sh [opciones]
#
#   --fecha AAAAMMDD    Build de https://build.protomaps.com/<fecha>.pmtiles. Por defecto, el
#                       más reciente que responda (se prueban los últimos 10 días).
#   --fuente RUTA|URL   Archivo de entrada en lugar del build de Protomaps (pruebas con fixture).
#                       Un .mbtiles local se convierte antes a .pmtiles.
#   --bbox O,S,E,N      Caja a extraer. Por defecto SERVICE_AREA de packages/contracts.
#   --maxzoom N         Zoom máximo (por defecto 15).
#   --salida CARPETA    Carpeta de trabajo (por defecto ./mapa-base, ignorada por git).
#   --ambiente NOMBRE   staging o production: sube a panter-tiles-staging o panter-tiles.
#                       Sin esta opción no se sube nada (solo extrae y verifica).
#   --sin-assets        No descarga ni sube glifos y sprites.
#   -h, --help          Muestra esta ayuda.
#
# Requiere: curl, jq, sha256sum, tar. Para subir: CLOUDFLARE_API_TOKEN (con R2 Edit) y
# CLOUDFLARE_ACCOUNT_ID en el entorno, y las dependencias del repositorio instaladas (wrangler
# de api/core). La CLI pmtiles se descarga con versión y checksum fijados si no está en el PATH.
#
# Orden de subida: glifos y sprites → .pmtiles → basemap.json. Los clientes leen basemap.json
# para saber qué archivo usar, así que solo cambian de mapa cuando todo lo demás ya está en R2.
set -euo pipefail

# --- Versiones fijadas -------------------------------------------------------------------------
PMTILES_VERSION="1.31.2"
PMTILES_SHA256="3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f"
# protomaps/basemaps-assets no publica releases ni tags: se fija un commit concreto de main.
ASSETS_COMMIT="028c18f713baecad011301ff7a69acc39bcc2ae7"
# Fuentes que usan las capas de @protomaps/basemaps (packages/map-style) y rangos de glifos que
# cubren el español: Latin-1, Latin Extended A/B, diacríticos, Latin Extended Additional,
# puntuación general (–, “ ”, …) y símbolos de letras (№, ℃). El Worker responde un glifo vacío
# para los demás rangos (modules/tiles/domain/tile-file.ts).
FONTS=("Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic")
GLYPH_RANGES=("0-255" "256-511" "512-767" "768-1023" "7680-7935" "8192-8447" "8448-8703")
SPRITES=(light dark)
# SERVICE_AREA de packages/contracts/src/places.ts (oeste, sur, este, norte). Una prueba de
# api/core comprueba que coincidan.
SERVICE_AREA_BBOX="-77.05,0.4,-76.3,1.3"
# Límite de `wrangler r2 object put` (subida en una sola parte).
MAX_UPLOAD_BYTES=$((300 * 1024 * 1024))

fail() {
  echo "generar_mapa: $*" >&2
  exit 1
}
log() { echo "==> $*"; }

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fecha=""
fuente=""
bbox="$SERVICE_AREA_BBOX"
maxzoom=15
salida="$repo_root/mapa-base"
ambiente=""
con_assets=true

while [ $# -gt 0 ]; do
  case "$1" in
    --fecha) fecha="${2:-}"; shift 2 ;;
    --fuente) fuente="${2:-}"; shift 2 ;;
    --bbox) bbox="${2:-}"; shift 2 ;;
    --maxzoom) maxzoom="${2:-}"; shift 2 ;;
    --salida) salida="${2:-}"; shift 2 ;;
    --ambiente) ambiente="${2:-}"; shift 2 ;;
    --sin-assets) con_assets=false; shift ;;
    -h | --help) sed -n '2,27p' "$0"; exit 0 ;;
    *) fail "opción desconocida: $1 (usa --help)." ;;
  esac
done

# --- Validación de argumentos ------------------------------------------------------------------
for cmd in curl jq sha256sum tar; do
  command -v "$cmd" >/dev/null || fail "no se encontró $cmd."
done

if [ -n "$fecha" ]; then
  [[ "$fecha" =~ ^20[0-9]{6}$ ]] || fail "--fecha debe ser AAAAMMDD (recibido: $fecha)."
  date -u -d "$fecha" +%Y%m%d >/dev/null 2>&1 || fail "--fecha no es una fecha válida: $fecha."
fi
[[ "$maxzoom" =~ ^[0-9]+$ ]] && [ "$maxzoom" -le 15 ] || fail "--maxzoom debe estar entre 0 y 15."

num='-?[0-9]+(\.[0-9]+)?'
[[ "$bbox" =~ ^$num,$num,$num,$num$ ]] || fail "--bbox debe ser oeste,sur,este,norte (recibido: $bbox)."
IFS=, read -r west south east north <<<"$bbox"
awk -v w="$west" -v s="$south" -v e="$east" -v n="$north" \
  'BEGIN { exit !(w >= -180 && e <= 180 && s >= -90 && n <= 90 && w < e && s < n) }' ||
  fail "--bbox fuera de rango o invertida: $bbox."

bucket=""
case "$ambiente" in
  "") ;;
  staging) bucket="panter-tiles-staging" ;;
  production) bucket="panter-tiles" ;;
  *) fail "ambiente desconocido: $ambiente (usa staging o production)." ;;
esac
if [ -n "$bucket" ]; then
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || fail "falta CLOUDFLARE_API_TOKEN para subir a R2."
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || fail "falta CLOUDFLARE_ACCOUNT_ID para subir a R2."
fi

mkdir -p "$salida"
salida="$(cd "$salida" && pwd)"

# --- CLI pmtiles con versión fijada ------------------------------------------------------------
pmtiles_bin="$(command -v pmtiles || true)"
if [ -z "$pmtiles_bin" ] || ! "$pmtiles_bin" version 2>/dev/null | grep -q "pmtiles $PMTILES_VERSION,"; then
  [ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] ||
    fail "instala pmtiles $PMTILES_VERSION (github.com/protomaps/go-pmtiles/releases) y ponlo en el PATH."
  tool_dir="$salida/.herramientas/pmtiles-$PMTILES_VERSION"
  pmtiles_bin="$tool_dir/pmtiles"
  if [ ! -x "$pmtiles_bin" ]; then
    log "Descargando pmtiles $PMTILES_VERSION"
    mkdir -p "$tool_dir"
    tarball="$tool_dir/pmtiles.tar.gz"
    curl -fsSL --retry 3 -o "$tarball" \
      "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz"
    echo "$PMTILES_SHA256  $tarball" | sha256sum -c --quiet - ||
      fail "el checksum de pmtiles no coincide; no se usa el binario descargado."
    tar -xzf "$tarball" -C "$tool_dir" pmtiles
    rm -f "$tarball"
  fi
fi
"$pmtiles_bin" version

# --- Fuente: build diario de Protomaps ---------------------------------------------------------
build_url() { echo "https://build.protomaps.com/$1.pmtiles"; }
build_exists() { curl -fsSI --retry 2 -o /dev/null "$(build_url "$1")"; }

if [ -z "$fuente" ]; then
  if [ -z "$fecha" ]; then
    log "Buscando el build diario más reciente de Protomaps"
    for i in $(seq 0 9); do
      candidata="$(date -u -d "-$i day" +%Y%m%d)"
      if build_exists "$candidata"; then fecha="$candidata"; break; fi
    done
    [ -n "$fecha" ] || fail "no hay builds de Protomaps en los últimos 10 días (build.protomaps.com)."
  else
    build_exists "$fecha" ||
      fail "no existe el build $fecha en build.protomaps.com (solo se guardan los recientes)."
  fi
  fuente="$(build_url "$fecha")"
else
  # Con fuente propia (fixture), la fecha solo da nombre al archivo.
  fecha="${fecha:-$(date -u +%Y%m%d)}"
  if [[ "$fuente" == *.mbtiles ]]; then
    [ -f "$fuente" ] || fail "no existe $fuente."
    log "Convirtiendo $fuente a PMTiles"
    "$pmtiles_bin" convert --force "$fuente" "$salida/fuente.pmtiles"
    fuente="$salida/fuente.pmtiles"
  fi
fi

nombre="panter-${fecha}.pmtiles"
archivo="$salida/$nombre"

# --- Extracción y verificación -----------------------------------------------------------------
log "Extrayendo $bbox hasta z$maxzoom de $fuente"
rm -f "$archivo"
"$pmtiles_bin" extract "$fuente" "$archivo" --bbox="$bbox" --maxzoom="$maxzoom" --download-threads=8

log "Verificando $nombre"
"$pmtiles_bin" verify "$archivo"
"$pmtiles_bin" show "$archivo"
header="$("$pmtiles_bin" show --header-json "$archivo")"
echo "$header" | jq -e --argjson z "$maxzoom" '.maxzoom == $z and .tile_type == "mvt"' >/dev/null ||
  fail "el archivo no tiene teselas vectoriales hasta z$maxzoom: $header"
echo "$header" | jq -e --argjson w "$west" --argjson s "$south" --argjson e "$east" --argjson n "$north" '
  .bounds as [$bw, $bs, $be, $bn]
  | ($bw - $w | fabs) < 0.001 and ($bs - $s | fabs) < 0.001
    and ($be - $e | fabs) < 0.001 and ($bn - $n | fabs) < 0.001' >/dev/null ||
  fail "los límites del archivo no coinciden con la caja $bbox: $header"

tamano="$(stat -c %s "$archivo")"
[ "$tamano" -gt 0 ] || fail "el archivo extraído está vacío."
[ "$tamano" -le "$MAX_UPLOAD_BYTES" ] ||
  fail "el archivo pesa $tamano bytes y supera el límite de subida de wrangler (300 MiB); baja --maxzoom o reduce la caja."
sha="$(sha256sum "$archivo" | cut -d' ' -f1)"

jq -n \
  --arg file "$nombre" --arg build "$fecha" --argjson maxzoom "$maxzoom" \
  --argjson bounds "[$west,$south,$east,$north]" --argjson size "$tamano" --arg sha256 "$sha" \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg pmtiles "$PMTILES_VERSION" \
  --arg assets "$ASSETS_COMMIT" \
  '{file: $file, build: $build, bounds: $bounds, maxzoom: $maxzoom, size: $size,
    sha256: $sha256, generatedAt: $generatedAt, pmtilesVersion: $pmtiles,
    assetsCommit: $assets}' >"$salida/basemap.json"
log "Listo: $archivo ($tamano bytes)"
cat "$salida/basemap.json"

# --- Glifos y sprites (protomaps/basemaps-assets, commit fijado) -------------------------------
assets_dir="$salida/assets"
if $con_assets; then
  log "Descargando glifos y sprites de basemaps-assets@${ASSETS_COMMIT:0:7}"
  raw="https://raw.githubusercontent.com/protomaps/basemaps-assets/$ASSETS_COMMIT"
  for font in "${FONTS[@]}"; do
    mkdir -p "$assets_dir/fonts/$font"
    for range in "${GLYPH_RANGES[@]}"; do
      curl -fsSL --retry 3 -o "$assets_dir/fonts/$font/$range.pbf" \
        "$raw/fonts/${font// /%20}/$range.pbf"
    done
  done
  mkdir -p "$assets_dir/sprites/v4"
  for sprite in "${SPRITES[@]}"; do
    for suffix in "" "@2x"; do
      for ext in json png; do
        curl -fsSL --retry 3 -o "$assets_dir/sprites/v4/$sprite$suffix.$ext" \
          "$raw/sprites/v4/$sprite$suffix.$ext"
      done
    done
  done
  for json in "$assets_dir"/sprites/v4/*.json; do
    jq -e 'type == "object" and length > 0' "$json" >/dev/null || fail "sprite inválido: $json"
  done
fi

# --- Subida a R2 -------------------------------------------------------------------------------
if [ -z "$bucket" ]; then
  log "Sin --ambiente: no se sube nada a R2."
  exit 0
fi

wrangler() { pnpm --dir "$repo_root/api/core" exec wrangler "$@"; }

# put <clave> <archivo> <content-type> <cache-control>
put() {
  local intento
  for intento in 1 2 3; do
    if wrangler r2 object put "$bucket/$1" --remote --file "$2" \
      --content-type "$3" --cache-control "$4" >/dev/null; then
      echo "   subido $bucket/$1"
      return 0
    fi
    echo "   reintento $intento de $bucket/$1" >&2
    sleep $((intento * 5))
  done
  fail "no se pudo subir $bucket/$1."
}

if $con_assets; then
  log "Subiendo glifos y sprites a $bucket"
  for font in "${FONTS[@]}"; do
    for range in "${GLYPH_RANGES[@]}"; do
      put "fonts/$font/$range.pbf" "$assets_dir/fonts/$font/$range.pbf" \
        application/x-protobuf "public, max-age=604800"
    done
  done
  for f in "$assets_dir"/sprites/v4/*; do
    case "$f" in *.json) type=application/json ;; *) type=image/png ;; esac
    put "sprites/v4/$(basename "$f")" "$f" "$type" "public, max-age=604800"
  done
fi

log "Subiendo $nombre a $bucket"
put "$nombre" "$archivo" application/octet-stream "public, max-age=31536000, immutable"
put "basemap.json" "$salida/basemap.json" application/json "public, max-age=300"
log "Mapa base $fecha publicado en $bucket. Los clientes lo toman de /tiles/basemap.json."
