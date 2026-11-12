#!/usr/bin/env bash
# Pruebas de los scripts del camino de release de la APK (HU-008), sin secretos reales:
# cálculo de versión, changelog, generación del keystore y validación de secretos.
#   bash scripts/probar_app_release.sh
# Requiere git y keytool (JDK 17+). Lo ejecuta app-release-check.yml en cada PR.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
version_sh="$root/scripts/app_version.sh"
changelog_sh="$root/scripts/app_changelog.sh"
keystore_sh="$root/scripts/generar_keystore.sh"
prepare_sh="$root/.github/actions/android-release-apk/preparar-keystore.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

passed=0
ok() {
  passed=$((passed + 1))
  echo "  ok - $*"
}
die() {
  echo "  FALLO - $*" >&2
  exit 1
}
expect_contains() { grep -qF -- "$2" <<<"$1" || die "$3: falta \"$2\" en:"$'\n'"$1"; }
expect_missing() { ! grep -qF -- "$2" <<<"$1" || die "$3: sobra \"$2\" en:"$'\n'"$1"; }

echo "app_version.sh"
out="$(bash "$version_sh" app-v0.3.0 42)"
[ "$out" = $'tag=app-v0.3.0\nversion=0.3.0\nversion_code=142\nprerelease=false' ] || die "tag app-v0.3.0: $out"
ok "app-v0.3.0 + run 42 -> 0.3.0 (142)"
out="$(bash "$version_sh" refs/tags/app-v1.0.0-rc.1 7)"
expect_contains "$out" "version=1.0.0-rc.1" "refs/tags"
expect_contains "$out" "prerelease=true" "prerelease"
ok "refs/tags/app-v1.0.0-rc.1 -> prerelease"
out="$(VERSION_CODE_OFFSET=0 bash "$version_sh" 0.1.0-staging.9 9)"
expect_contains "$out" "version_code=9" "offset 0"
ok "versión sin tag y VERSION_CODE_OFFSET=0"
[ "$(bash "$version_sh" app-v0.3.1 43 | sed -n 's/^version_code=//p')" -gt 142 ] || die "versionCode no crece"
ok "versionCode crece con el número de ejecución"
for bad in "app-v0.3 1" "v0.3.0 1" "app-v01.2.3 1" "app-v1.2.3+meta 1" "app-v0.3.0 0" "app-v0.3.0 abc" "app-v0.3.0 2100000000"; do
  # shellcheck disable=SC2086
  if bash "$version_sh" $bad >/dev/null 2>&1; then die "debería rechazar: $bad"; fi
done
ok "rechaza versiones y números de ejecución inválidos"

echo "app_changelog.sh"
repo="$work/repo"
git init -q -b main "$repo"
export GIT_AUTHOR_NAME=ci GIT_AUTHOR_EMAIL=ci@example.com GIT_COMMITTER_NAME=ci GIT_COMMITTER_EMAIL=ci@example.com
commit() { git -C "$repo" commit -q --allow-empty -m "$1"; }
commit "chore: inicio del monorepo"
commit "feat(app): pantalla de inicio"
git -C "$repo" tag app-v0.1.0
commit "feat(app)!: navegación por rol"
commit "fix(api): corrige el OTP"
commit "docs: instrucciones de instalación"
commit $'refactor(app): config\n\nBREAKING CHANGE: cambia APP_ENV'
commit "commit sin formato"
git -C "$repo" checkout -q -b feature/x
commit "feat: rama mezclada"
git -C "$repo" checkout -q main
git -C "$repo" merge -q --no-ff -m "Merge pull request #1 from feature/x" feature/x
git -C "$repo" tag app-v0.2.0

out="$(cd "$repo" && GITHUB_REPOSITORY=acme/panter bash "$changelog_sh" app-v0.2.0)"
expect_contains "$out" "## Cambios desde app-v0.1.0" "encabezado"
expect_contains "$out" "compare/app-v0.1.0...app-v0.2.0" "enlace de comparación"
expect_contains "$out" "### Cambios incompatibles" "breaking"
expect_contains "$out" "### Nuevas funciones" "feat"
expect_contains "$out" "- **app:** navegación por rol (" "feat con alcance"
expect_contains "$out" "- rama mezclada (" "feat de la rama mezclada"
expect_contains "$out" "### Correcciones" "fix"
expect_contains "$out" "- **api:** corrige el OTP (" "fix con alcance"
expect_contains "$out" "### Otros cambios" "otros"
expect_contains "$out" "- instrucciones de instalación (" "docs"
expect_contains "$out" "- commit sin formato (" "sin formato"
expect_missing "$out" "pantalla de inicio" "no incluye la versión anterior"
expect_missing "$out" "Merge pull request" "omite merges"
breaking="$(sed -n '/### Cambios incompatibles/,/### Nuevas funciones/p' <<<"$out")"
expect_contains "$breaking" "navegación por rol" "breaking por !"
expect_contains "$breaking" "**app:** config" "breaking por BREAKING CHANGE"
ok "agrupa feat/fix/otros y cambios incompatibles desde el tag anterior"

out="$(cd "$repo" && bash "$changelog_sh" app-v0.1.0)"
expect_contains "$out" "## Primera versión" "primera versión"
expect_contains "$out" "pantalla de inicio" "primera versión incluye todo"
expect_missing "$out" "Comparar:" "primera versión sin comparación"
ok "primera versión sin tag anterior"

commit "fix: después del tag"
out="$(cd "$repo" && bash "$changelog_sh" app-v0.3.0)"
expect_contains "$out" "## Cambios desde app-v0.2.0" "tag nuevo (workflow_dispatch)"
expect_contains "$out" "después del tag" "tag nuevo incluye HEAD"
ok "tag todavía inexistente usa HEAD"
git -C "$repo" tag app-v0.3.0
commit "chore: otro"
out="$(cd "$repo" && bash "$changelog_sh" app-v0.3.0 app-v0.3.0)"
expect_missing "$out" "- otro (" "respeta el commit final"
ok "respeta el commit final indicado"
git -C "$repo" tag app-v0.4.0
out="$(cd "$repo" && bash "$changelog_sh" app-v0.4.0)"
expect_contains "$out" "- otro (" "un solo commit"
expect_missing "$out" "después del tag" "solo desde app-v0.3.0"
ok "solo commits desde el tag anterior"

echo "generar_keystore.sh"
keys="$work/keys"
password="clave-temporal-$RANDOM-$RANDOM"
out="$(PANTER_KEYSTORE_PASSWORD="$password" bash "$keystore_sh" "$keys/panter-upload.jks")"
[ -s "$keys/panter-upload.jks" ] || die "no generó el keystore"
[ -s "$keys/panter-upload.jks.base64.txt" ] || die "no generó el base64"
expect_contains "$out" "Certificado SHA-256:" "muestra el SHA-256"
details="$(keytool -list -v -keystore "$keys/panter-upload.jks" -storepass "$password" -alias panter-upload)"
expect_contains "$details" "PrivateKeyEntry" "contiene la llave privada"
expect_contains "$details" "4096-bit RSA" "RSA 4096"
ok "genera keystore PKCS12 RSA 4096 con alias panter-upload"
if PANTER_KEYSTORE_PASSWORD="$password" bash "$keystore_sh" "$keys/panter-upload.jks" >/dev/null 2>&1; then
  die "debería negarse a sobrescribir el keystore"
fi
ok "no sobrescribe un keystore existente"
if PANTER_KEYSTORE_PASSWORD="$password" bash "$keystore_sh" "$root/no-debe-existir.jks" >/dev/null 2>&1; then
  rm -f "$root/no-debe-existir.jks"*
  die "debería negarse a guardar el keystore dentro del repositorio"
fi
ok "no guarda el keystore dentro del repositorio"
if PANTER_KEYSTORE_PASSWORD=corta bash "$keystore_sh" "$keys/otra.jks" >/dev/null 2>&1; then
  die "debería exigir contraseñas de 12+ caracteres"
fi
ok "exige contraseña de al menos 12 caracteres"

echo "preparar-keystore.sh"
b64="$(cat "$keys/panter-upload.jks.base64.txt")"
run_prepare() {
  : >"$work/output"
  GITHUB_OUTPUT="$work/output" KEYSTORE_DIR="$work/runner" bash "$prepare_sh" 2>&1
}
if out="$(REQUIRE_SIGNING=true run_prepare)"; then die "debería fallar sin secretos"; fi
expect_contains "$out" "::error title=Faltan los secretos del keystore::" "error claro"
expect_contains "$out" "ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD" "lista los secretos"
ok "falla sin secretos cuando la firma es obligatoria (app.yml)"
if out="$(REQUIRE_SIGNING=true KEYSTORE_BASE64="$b64" KEYSTORE_PASSWORD="$password" KEY_ALIAS=panter-upload run_prepare)"; then
  die "debería fallar con un secreto faltante"
fi
expect_contains "$out" "Faltan ANDROID_KEY_PASSWORD." "secreto faltante"
ok "falla si falta un solo secreto"
out="$(REQUIRE_SIGNING=false run_prepare)"
expect_contains "$out" "::warning title=APK firmada con la llave debug::" "aviso debug"
expect_contains "$(cat "$work/output")" "signing=debug" "salida debug"
ok "usa la llave debug con aviso cuando la firma es opcional (app-preview.yml)"
out="$(REQUIRE_SIGNING=true KEYSTORE_BASE64="$b64" KEYSTORE_PASSWORD="$password" KEY_ALIAS=panter-upload KEY_PASSWORD="$password" run_prepare)"
expect_contains "$(cat "$work/output")" "signing=upload" "salida upload"
expected="$(sed -n 's/^[[:space:]]*SHA256: *//p' <<<"$details" | head -n 1 | tr -d ':' | tr 'A-F' 'a-f')"
expect_contains "$(cat "$work/output")" "cert-sha256=$expected" "SHA-256 del certificado"
cmp -s "$work/runner/panter-upload.jks" "$keys/panter-upload.jks" || die "keystore decodificado distinto"
ok "decodifica el keystore y obtiene el SHA-256 del certificado"
if out="$(REQUIRE_SIGNING=true KEYSTORE_BASE64="$b64" KEYSTORE_PASSWORD="incorrecta-123" KEY_ALIAS=panter-upload KEY_PASSWORD=x run_prepare)"; then
  die "debería fallar con contraseña incorrecta"
fi
expect_contains "$out" "Keystore o alias incorrectos" "contraseña incorrecta"
if out="$(REQUIRE_SIGNING=true KEYSTORE_BASE64="$b64" KEYSTORE_PASSWORD="$password" KEY_ALIAS=otro KEY_PASSWORD=x run_prepare)"; then
  die "debería fallar con alias incorrecto"
fi
ok "falla con contraseña o alias incorrectos"
if out="$(REQUIRE_SIGNING=true KEYSTORE_BASE64="no es base64!" KEYSTORE_PASSWORD=x KEY_ALIAS=x KEY_PASSWORD=x run_prepare)"; then
  die "debería fallar con base64 inválido"
fi
ok "falla con base64 inválido"

echo "$passed pruebas correctas."
