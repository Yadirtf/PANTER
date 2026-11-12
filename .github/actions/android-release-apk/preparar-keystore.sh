#!/usr/bin/env bash
# Decodifica el keystore de los secretos y comprueba que alias y contraseñas son correctos.
#
# Entradas (entorno): KEYSTORE_BASE64, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD,
#   REQUIRE_SIGNING (true|false), KEYSTORE_DIR (por defecto $RUNNER_TEMP).
# Salidas ("$GITHUB_OUTPUT"): signing=upload|debug, store-file, cert-sha256 (hex en minúsculas).
#
# Sin los 4 secretos: si REQUIRE_SIGNING=true falla (una release sin la llave fija no se podría
# actualizar en los teléfonos); si no, avisa y el release se firma con la llave debug.
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
dir="${KEYSTORE_DIR:-${RUNNER_TEMP:-/tmp}}"

missing=()
[ -n "${KEYSTORE_BASE64:-}" ] || missing+=(ANDROID_KEYSTORE_BASE64)
[ -n "${KEYSTORE_PASSWORD:-}" ] || missing+=(ANDROID_KEYSTORE_PASSWORD)
[ -n "${KEY_ALIAS:-}" ] || missing+=(ANDROID_KEY_ALIAS)
[ -n "${KEY_PASSWORD:-}" ] || missing+=(ANDROID_KEY_PASSWORD)

if [ "${#missing[@]}" -gt 0 ]; then
  list="${missing[*]}"
  if [ "${REQUIRE_SIGNING:-false}" = true ]; then
    echo "::error title=Faltan los secretos del keystore::Faltan ${list// /, }. Una release debe firmarse siempre con la misma llave o Android no permitirá actualizar la app. Genera la llave una sola vez con scripts/generar_keystore.sh y carga los 4 secretos (ver app/README.md)."
    exit 1
  fi
  echo "::warning title=APK firmada con la llave debug::Faltan ${list// /, }. Esta APK se firma con la llave debug: sirve para probar, pero no se puede instalar encima de una APK firmada con la llave de PANTER."
  {
    echo "signing=debug"
    echo "store-file="
    echo "cert-sha256="
  } >>"$out"
  exit 0
fi

mkdir -p "$dir"
store_file="$dir/panter-upload.jks"
(
  umask 077
  if ! printf '%s' "$KEYSTORE_BASE64" | tr -d ' \r\n' | base64 --decode >"$store_file" 2>/dev/null; then
    echo "::error title=Keystore inválido::ANDROID_KEYSTORE_BASE64 no es base64 válido. Carga el contenido del archivo .base64.txt que genera scripts/generar_keystore.sh (un solo renglón)."
    exit 1
  fi
)

export PANTER_CHECK_STORE_PASS="$KEYSTORE_PASSWORD"
if ! listing="$(keytool -list -v -keystore "$store_file" -alias "$KEY_ALIAS" \
  -storepass:env PANTER_CHECK_STORE_PASS 2>&1)"; then
  echo "::error title=Keystore o alias incorrectos::keytool no pudo abrir el keystore con ANDROID_KEYSTORE_PASSWORD o no contiene el alias ANDROID_KEY_ALIAS."
  echo "$listing" | grep -i 'error' | sed 's/^/  /' >&2 || true
  exit 1
fi
unset PANTER_CHECK_STORE_PASS

sha256="$(printf '%s\n' "$listing" | sed -n 's/^[[:space:]]*SHA256: *//p' | head -n 1 | tr -d ':' | tr 'A-F' 'a-f')"
[ -n "$sha256" ] || {
  echo "::error::No se pudo leer el SHA-256 del certificado del keystore."
  exit 1
}

{
  echo "signing=upload"
  echo "store-file=$store_file"
  echo "cert-sha256=$sha256"
} >>"$out"
echo "Keystore listo (alias $KEY_ALIAS, certificado SHA-256 $sha256)."
