#!/usr/bin/env bash
# Genera el changelog (Markdown) de una versión de la app a partir de Conventional Commits,
# desde el tag app-v* anterior (HU-008).
#
# Uso: scripts/app_changelog.sh <tag> [<commit final>]
#
#   <tag>           tag de la versión (app-v0.3.0). Puede no existir todavía (workflow_dispatch).
#   <commit final>  último commit incluido; por defecto el tag (o HEAD si el tag no existe).
#
# Agrupa: cambios incompatibles (tipo! o "BREAKING CHANGE" en el cuerpo), funciones (feat),
# correcciones (fix) y otros cambios (resto de tipos y commits sin formato). Omite los merges.
# Requiere el historial completo y los tags (actions/checkout con fetch-depth: 0).
set -euo pipefail

fail() {
  echo "app_changelog: $*" >&2
  exit 1
}

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || fail "uso: $0 <tag> [<commit final>]"
tag="$1"

if [ "$#" -eq 2 ]; then
  end="$2"
elif git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  end="$tag"
else
  end="HEAD"
fi
git rev-parse -q --verify "$end^{commit}" >/dev/null || fail "no existe el commit \"$end\"."

# Tag app-v* más cercano alcanzable desde el padre del commit final (excluye el propio tag).
previous=""
if git rev-parse -q --verify "$end^" >/dev/null; then
  previous="$(git describe --tags --abbrev=0 --match 'app-v*' "$end^" 2>/dev/null || true)"
fi

if [ -n "$previous" ]; then
  range="$previous..$end"
else
  range="$end"
fi

breaking_body="$(git log --no-merges --format='%h' --grep='BREAKING[ -]CHANGE' "$range")"

declare -a breaking=() features=() fixes=() others=()
re='^([a-zA-Z]+)(\(([^)]+)\))?(!)?: (.+)$'

while IFS= read -r line; do
  [ -n "$line" ] || continue
  hash="${line%% *}"
  subject="${line#* }"

  if [[ "$subject" =~ $re ]]; then
    type="${BASH_REMATCH[1],,}"
    scope="${BASH_REMATCH[3]}"
    bang="${BASH_REMATCH[4]}"
    description="${BASH_REMATCH[5]}"
  else
    type=""
    scope=""
    bang=""
    description="$subject"
  fi

  entry="- ${scope:+**$scope:** }$description ($hash)"

  if [ -n "$bang" ] || grep -qx "$hash" <<<"$breaking_body"; then
    breaking+=("$entry")
  fi
  case "$type" in
    feat) features+=("$entry") ;;
    fix) fixes+=("$entry") ;;
    *) others+=("$entry") ;;
  esac
done < <(git log --no-merges --format='%h %s' "$range")

section() {
  local title="$1"
  shift
  [ "$#" -gt 0 ] || return 0
  printf '\n### %s\n\n' "$title"
  printf '%s\n' "$@"
}

if [ -n "$previous" ]; then
  echo "## Cambios desde $previous"
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then
    printf '\nComparar: %s/%s/compare/%s...%s\n' \
      "${GITHUB_SERVER_URL:-https://github.com}" "$GITHUB_REPOSITORY" "$previous" "$tag"
  fi
else
  echo "## Primera versión"
fi

total=$((${#features[@]} + ${#fixes[@]} + ${#others[@]}))
if [ "$total" -eq 0 ]; then
  printf '\n- Sin cambios registrados.\n'
  exit 0
fi

section "Cambios incompatibles" "${breaking[@]}"
section "Nuevas funciones" "${features[@]}"
section "Correcciones" "${fixes[@]}"
section "Otros cambios" "${others[@]}"
