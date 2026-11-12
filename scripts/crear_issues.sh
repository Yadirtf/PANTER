#!/usr/bin/env bash
# Carga Docs/BACKLOG.md como issues de GitHub (épicas, historias, etiquetas e hitos).
# Requisitos: GitHub CLI autenticado (gh auth login) y python3.
# Uso: scripts/crear_issues.sh [--repo owner/nombre] [--dry-run]
set -euo pipefail
command -v gh >/dev/null || { echo "Falta GitHub CLI (gh)"; exit 1; }
command -v python3 >/dev/null || { echo "Falta python3"; exit 1; }
exec python3 "$(dirname "$0")/crear_issues.py" "$@"
