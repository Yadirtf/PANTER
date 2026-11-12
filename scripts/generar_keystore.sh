#!/usr/bin/env bash
# Genera UNA SOLA VEZ la llave de firma (keystore) de la APK de PANTER y, opcionalmente,
# carga los 4 secretos en GitHub (HU-008, Docs/ESPECIFICACION.md §10.3).
#
#   scripts/generar_keystore.sh [ruta.jks] [--subir]
#
#   ruta.jks  destino del keystore (por defecto ~/panter-keys/panter-upload.jks). Debe quedar
#             FUERA del repositorio.
#   --subir   carga ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS y
#             ANDROID_KEY_PASSWORD como secretos del repositorio con `gh secret set`.
#
# Variables opcionales (para uso no interactivo, p. ej. el keystore TEMPORAL del CI):
#   PANTER_KEYSTORE_PASSWORD  contraseña (mínimo 12 caracteres); si falta se pide por teclado
#   PANTER_KEY_ALIAS          alias (por defecto panter-upload)
#   PANTER_KEY_DNAME          nombre distinguido del certificado
#   GITHUB_REPO               repositorio para --subir (por defecto Yadirtf/PANTER)
#
# IMPORTANTE: guarda el .jks y la contraseña en un lugar seguro fuera del repositorio
# (gestor de contraseñas + copia cifrada). Si se pierden, ninguna APK nueva podrá instalarse
# encima de las anteriores: cada usuario tendría que desinstalar la app y perder sus datos.
set -euo pipefail

fail() {
  echo "generar_keystore: $*" >&2
  exit 1
}

command -v keytool >/dev/null || fail "no se encontró keytool (instala un JDK 17+)."

keystore=""
upload=false
for arg in "$@"; do
  case "$arg" in
    --subir) upload=true ;;
    -h | --help)
      sed -n '2,21p' "$0"
      exit 0
      ;;
    -*) fail "opción desconocida: $arg" ;;
    *) keystore="$arg" ;;
  esac
done
keystore="${keystore:-$HOME/panter-keys/panter-upload.jks}"
alias_name="${PANTER_KEY_ALIAS:-panter-upload}"
dname="${PANTER_KEY_DNAME:-CN=PANTER, OU=App movil, O=PANTER, L=Villagarzon, ST=Putumayo, C=CO}"
repo="${GITHUB_REPO:-Yadirtf/PANTER}"

[ ! -e "$keystore" ] || fail "$keystore ya existe. La llave se genera una sola vez: no la reemplaces."

mkdir -p "$(dirname "$keystore")"
keystore="$(cd "$(dirname "$keystore")" && pwd)/$(basename "$keystore")"

if repo_root="$(git -C "$(dirname "$keystore")" rev-parse --show-toplevel 2>/dev/null)"; then
  fail "$keystore está dentro del repositorio git $repo_root. Guárdalo fuera del repositorio."
fi

password="${PANTER_KEYSTORE_PASSWORD:-}"
if [ -z "$password" ]; then
  read -r -s -p "Contraseña del keystore (mínimo 12 caracteres): " password
  echo
  read -r -s -p "Repite la contraseña: " confirmation
  echo
  [ "$password" = "$confirmation" ] || fail "las contraseñas no coinciden."
fi
[ "${#password}" -ge 12 ] || fail "la contraseña debe tener al menos 12 caracteres."

umask 077
export PANTER_KS_PASS="$password"
# PKCS12 usa la misma contraseña para el almacén y la llave: ANDROID_KEY_PASSWORD = ANDROID_KEYSTORE_PASSWORD.
# Validez de 10000 días (~27 años), RSA 4096.
keytool -genkeypair \
  -storetype PKCS12 \
  -keystore "$keystore" \
  -alias "$alias_name" \
  -keyalg RSA -keysize 4096 -sigalg SHA256withRSA \
  -validity 10000 \
  -dname "$dname" \
  -storepass:env PANTER_KS_PASS \
  -keypass:env PANTER_KS_PASS >/dev/null
[ -s "$keystore" ] || fail "keytool no generó el keystore."

sha256="$(keytool -list -v -keystore "$keystore" -alias "$alias_name" -storepass:env PANTER_KS_PASS |
  sed -n 's/^[[:space:]]*SHA256: *//p' | head -n 1)"
unset PANTER_KS_PASS

base64_file="$keystore.base64.txt"
base64 <"$keystore" | tr -d '\n' >"$base64_file"

cat <<EOF

Keystore generado: $keystore
  Alias:                    $alias_name
  Certificado SHA-256:      $sha256
  Base64 (un solo renglón): $base64_file

Guarda AHORA el .jks y la contraseña en un lugar seguro FUERA del repositorio (gestor de
contraseñas y una copia cifrada). Anota el SHA-256: el resumen de app.yml lo muestra en cada
release y debe coincidir siempre. Borra $base64_file cuando hayas cargado los secretos.

Secretos de GitHub (Settings > Secrets and variables > Actions):
  ANDROID_KEYSTORE_BASE64    contenido de $base64_file
  ANDROID_KEYSTORE_PASSWORD  la contraseña
  ANDROID_KEY_ALIAS          $alias_name
  ANDROID_KEY_PASSWORD       la misma contraseña (PKCS12)
EOF

if [ "$upload" = true ]; then
  command -v gh >/dev/null || fail "no se encontró gh (GitHub CLI) para --subir."
  gh secret set ANDROID_KEYSTORE_BASE64 --repo "$repo" <"$base64_file"
  printf '%s' "$password" | gh secret set ANDROID_KEYSTORE_PASSWORD --repo "$repo"
  printf '%s' "$alias_name" | gh secret set ANDROID_KEY_ALIAS --repo "$repo"
  printf '%s' "$password" | gh secret set ANDROID_KEY_PASSWORD --repo "$repo"
  echo
  echo "Secretos cargados en $repo."
else
  cat <<EOF

Para cargarlos con GitHub CLI:
  gh secret set ANDROID_KEYSTORE_BASE64 --repo $repo < "$base64_file"
  gh secret set ANDROID_KEYSTORE_PASSWORD --repo $repo
  gh secret set ANDROID_KEY_ALIAS --repo $repo --body "$alias_name"
  gh secret set ANDROID_KEY_PASSWORD --repo $repo
EOF
fi
