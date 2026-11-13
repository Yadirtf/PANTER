#!/usr/bin/env bash
# Genera el par de llaves RSA 2048 de los access tokens JWT (RS256) de panter-api (HU-103) e
# imprime los comandos para cargarlas como secretos del Worker.
#
#   scripts/generar_llaves_jwt.sh [ambiente] [carpeta]
#
#   ambiente  staging (por defecto) o production
#   carpeta   destino de los PEM (por defecto ~/panter-keys/jwt-<ambiente>-<fecha>). Debe
#             quedar FUERA del repositorio.
#
# Crea en la carpeta:
#   jwt-private.pem  llave privada PKCS8 ("-----BEGIN PRIVATE KEY-----") → secreto JWT_PRIVATE_KEY
#   jwt-public.pem   llave pública SPKI ("-----BEGIN PUBLIC KEY-----")  → secreto JWT_PUBLIC_KEY
#   kid.txt          identificador sugerido para la var JWT_KID de api/core/wrangler.jsonc
#
# Después de cargar los secretos, borra la carpeta (o guárdala cifrada): la llave privada
# permite firmar sesiones de cualquier usuario. Generar llaves nuevas invalida los access
# tokens vigentes (duran 15 min); los refresh tokens siguen sirviendo.
set -euo pipefail

fail() {
  echo "generar_llaves_jwt: $*" >&2
  exit 1
}

case "${1:-}" in
  -h | --help)
    sed -n '2,18p' "$0"
    exit 0
    ;;
esac

command -v openssl >/dev/null || fail "no se encontró openssl."

env_name="${1:-staging}"
case "$env_name" in
  staging | production) ;;
  *) fail "ambiente desconocido: $env_name (usa staging o production)." ;;
esac

stamp="$(date +%Y%m%d)"
dir="${2:-$HOME/panter-keys/jwt-${env_name}-${stamp}}"
[ ! -e "$dir/jwt-private.pem" ] || fail "$dir/jwt-private.pem ya existe; usa otra carpeta."

mkdir -p "$dir"
dir="$(cd "$dir" && pwd)"
if repo_root="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)"; then
  fail "$dir está dentro del repositorio git $repo_root. Usa una carpeta fuera del repositorio."
fi

umask 077
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$dir/jwt-private.pem" 2>/dev/null
openssl pkey -in "$dir/jwt-private.pem" -pubout -out "$dir/jwt-public.pem" 2>/dev/null
kid="panter-${env_name}-${stamp}"
echo "$kid" >"$dir/kid.txt"

grep -q -- '-----BEGIN PRIVATE KEY-----' "$dir/jwt-private.pem" || fail "la llave privada no quedó en PKCS8."
grep -q -- '-----BEGIN PUBLIC KEY-----' "$dir/jwt-public.pem" || fail "la llave pública no quedó en SPKI."

worker="panter-api-staging"
[ "$env_name" = "production" ] && worker="panter-api"

cat <<EOF
Llaves JWT de ${env_name} generadas en: ${dir}
  jwt-private.pem  (PKCS8, secreta)
  jwt-public.pem   (SPKI, pública)
  kid sugerido     ${kid}

1) Carga los secretos del Worker ${worker} (desde api/core, con sesión de 'wrangler login'):

  cd api/core
  pnpm exec wrangler secret put JWT_PRIVATE_KEY --env ${env_name} < "${dir}/jwt-private.pem"
  pnpm exec wrangler secret put JWT_PUBLIC_KEY --env ${env_name} < "${dir}/jwt-public.pem"

   (O en Cloudflare → Workers & Pages → ${worker} → Settings → Variables and Secrets → Add →
   Secret, pegando el contenido completo de cada archivo, con las líneas BEGIN/END.)

2) Pon "JWT_KID": "${kid}" en env.${env_name}.vars de api/core/wrangler.jsonc (PR a develop).
   Cada rotación necesita un kid NUEVO: la web guarda el JWKS en caché (hasta 10 min) y elige
   la llave por kid. Con el mismo kid, los tokens nuevos fallarían hasta que expire la caché.

3) Comprueba: GET https://${worker}.<subdominio>.workers.dev/.well-known/jwks.json debe mostrar
   "kid": "${kid}".

4) Borra ${dir} cuando termines (o guárdalo cifrado fuera del repositorio).
EOF
