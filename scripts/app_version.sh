#!/usr/bin/env bash
# Calcula la versión de la APK (HU-008, Docs/ESPECIFICACION.md §10.3).
#
# Uso: scripts/app_version.sh <tag app-vX.Y.Z | versión X.Y.Z> <número de ejecución>
#
#   versionName  = el tag sin el prefijo `app-v` (SemVer: 0.3.0, 1.0.0-rc.1)
#   versionCode  = número de ejecución del workflow + VERSION_CODE_OFFSET (por defecto 100)
#
# github.run_number solo crece dentro de un mismo workflow. Si app.yml se renombra o se
# vuelve a crear, el contador empieza en 1: sube VERSION_CODE_OFFSET por encima del último
# versionCode publicado, o Android rechazará la actualización.
#
# Imprime líneas clave=valor para "$GITHUB_OUTPUT":
#   tag=app-v0.3.0  version=0.3.0  version_code=142  prerelease=false
set -euo pipefail

readonly MAX_VERSION_CODE=2100000000
readonly SEMVER='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'

fail() {
  echo "app_version: $*" >&2
  exit 1
}

[ "$#" -eq 2 ] || fail "uso: $0 <tag app-vX.Y.Z | X.Y.Z> <run_number>"

source_ref="$1"
run_number="$2"
offset="${VERSION_CODE_OFFSET:-100}"

version="${source_ref#refs/tags/}"
version="${version#app-v}"
[[ "$version" =~ $SEMVER ]] ||
  fail "versión inválida \"$source_ref\": usa un tag app-vX.Y.Z (p. ej. app-v0.3.0) o X.Y.Z."

[[ "$run_number" =~ ^[1-9][0-9]*$ ]] || fail "número de ejecución inválido: \"$run_number\"."
[[ "$offset" =~ ^(0|[1-9][0-9]*)$ ]] || fail "VERSION_CODE_OFFSET inválido: \"$offset\"."
[ "${#run_number}" -le 10 ] && [ "${#offset}" -le 10 ] || fail "versionCode fuera de rango."

version_code=$((run_number + offset))
[ "$version_code" -le "$MAX_VERSION_CODE" ] ||
  fail "versionCode $version_code supera el máximo de Android ($MAX_VERSION_CODE)."

prerelease=false
[[ "$version" == *-* ]] && prerelease=true

echo "tag=app-v$version"
echo "version=$version"
echo "version_code=$version_code"
echo "prerelease=$prerelease"
