#!/usr/bin/env bash
# Verifica la firma y la versión de la APK con apksigner y aapt2 (build-tools del runner).
#
# Entradas (entorno): APK, EXPECTED_VERSION, EXPECTED_VERSION_CODE, SIGNING (upload|debug),
#   EXPECTED_CERT_SHA256 (obligatorio si SIGNING=upload).
# Salidas ("$GITHUB_OUTPUT"): cert-sha256, package. Escribe un resumen en "$GITHUB_STEP_SUMMARY".
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

[ -f "$APK" ] || {
  echo "::error::No se encontró la APK en $APK."
  exit 1
}

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$sdk" ] || {
  echo "::error::ANDROID_HOME no está definido."
  exit 1
}
build_tools="$(find "$sdk/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)"
[ -x "$build_tools/apksigner" ] || {
  echo "::error::No se encontró apksigner en $sdk/build-tools."
  exit 1
}
echo "build-tools: $build_tools"

certs="$("$build_tools/apksigner" verify --verbose --print-certs "$APK")"
echo "$certs"

sha256="$(printf '%s\n' "$certs" | sed -nE 's/^(Signer #1|V[0-9.]+ Signer):? certificate SHA-256 digest: *//p' | head -n 1)"
subject="$(printf '%s\n' "$certs" | sed -nE 's/^(Signer #1|V[0-9.]+ Signer):? certificate DN: *//p' | head -n 1)"
[ -n "$sha256" ] || {
  echo "::error::apksigner no devolvió el SHA-256 del certificado."
  exit 1
}
grep -q '^Verified using v2 scheme (APK Signature Scheme v2): true' <<<"$certs" || {
  echo "::error::La APK no está firmada con APK Signature Scheme v2."
  exit 1
}

if [ "$SIGNING" = upload ]; then
  if [ "$sha256" != "${EXPECTED_CERT_SHA256:-}" ]; then
    echo "::error title=Firma inesperada::La APK está firmada con $sha256 y la llave de subida es ${EXPECTED_CERT_SHA256:-?}."
    exit 1
  fi
elif [[ "$subject" != *"CN=Android Debug"* ]]; then
  echo "::warning::Se esperaba la llave debug y el certificado es: $subject"
fi

badging="$("$build_tools/aapt2" dump badging "$APK" | head -n 1)"
echo "$badging"
package="$(sed -n "s/.*package: name='\([^']*\)'.*/\1/p" <<<"$badging")"
version_code="$(sed -n "s/.* versionCode='\([^']*\)'.*/\1/p" <<<"$badging")"
version_name="$(sed -n "s/.* versionName='\([^']*\)'.*/\1/p" <<<"$badging")"

if [ "$version_name" != "$EXPECTED_VERSION" ] || [ "$version_code" != "$EXPECTED_VERSION_CODE" ]; then
  echo "::error title=Versión inesperada::La APK tiene versionName=$version_name versionCode=$version_code y se esperaba $EXPECTED_VERSION ($EXPECTED_VERSION_CODE)."
  exit 1
fi

apk_sha256="$(sha256sum "$APK" | cut -d' ' -f1)"
size="$(du -h "$APK" | cut -f1)"
if [ "$SIGNING" = upload ]; then
  signed_with="llave de subida de PANTER"
else
  signed_with="llave **debug** (no actualizable sobre releases)"
fi

{
  echo "### APK $(basename "$APK")"
  echo
  echo "| Campo | Valor |"
  echo "| --- | --- |"
  echo "| Paquete | \`$package\` |"
  echo "| versionName | \`$version_name\` |"
  echo "| versionCode | \`$version_code\` |"
  echo "| Firmada con | $signed_with |"
  echo "| Certificado | \`$subject\` |"
  echo "| Certificado SHA-256 | \`$sha256\` |"
  echo "| SHA-256 de la APK | \`$apk_sha256\` |"
  echo "| Tamaño | $size |"
  echo
} >>"$summary"

{
  echo "cert-sha256=$sha256"
  echo "package=$package"
} >>"$out"
