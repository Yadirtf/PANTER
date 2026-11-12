#!/usr/bin/env python3
"""Carga Docs/BACKLOG.md como issues de GitHub (épicas, historias, etiquetas e hitos).

Usa solo la API REST a través de `gh api`. Es idempotente: si un issue con el mismo
prefijo de título ([E0], [HU-001]) ya existe, lo reutiliza en lugar de crearlo.

Uso:
    python3 scripts/crear_issues.py [--repo owner/nombre] [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKLOG = ROOT / "Docs" / "BACKLOG.md"
SPEC = "Docs/ESPECIFICACION.md"

MILESTONES = {
    "M0": ("M0 Fundaciones", "Sprint 0 · E0. Los tres servicios desplegados en staging con healthcheck; APK de prueba en Releases."),
    "M1": ("M1 Identidad", "Sprint 1 · E1. Login OTP en app y web; cada rol llega a su pantalla."),
    "M2": ("M2 Conductores, mapas y tarifas", "Sprints 2–3 · E2, E3, E4. Conductor aprobado por admin; mapa propio en app y web; estimado de tarifa."),
    "M3": ("M3 Tiempo real", "Sprint 4 · E5. Flota en vivo en la consola web."),
    "M4": ("M4 Viajes", "Sprints 5–6 · E6. Viaje completo de punta a punta con matching de 15 s."),
    "M5": ("M5 Cobro, seguridad y reputación", "Sprint 7 · E7, E8, E9, E10. Comisión descontada, SOS en consola, calificaciones."),
    "M6": ("M6 Piloto", "Sprint 8 · E11. Prueba de campo en Villagarzón y v1.0.0 de la APK."),
}

LABELS = {
    "tipo:epica": ("5319e7", "Épica: agrupa historias"),
    "tipo:historia": ("0e8a16", "Historia de usuario"),
    "area:api": ("1d76db", "api/core o api/realtime"),
    "area:web": ("0052cc", "web (Next.js)"),
    "area:app": ("006b75", "app móvil (Expo)"),
    "area:infra": ("bfdadc", "Repositorio, CI/CD, base de datos"),
    "area:contracts": ("c5def5", "packages/contracts"),
    "fase:1": ("fbca04", "Fase 1 · MVP urbano"),
    "fase:2": ("fef2c0", "Fase 2"),
    "prioridad:alta": ("b60205", "Prioridad alta"),
    "prioridad:media": ("d93f0b", "Prioridad media"),
    "prioridad:baja": ("e99695", "Prioridad baja"),
}


@dataclass
class Story:
    id: str
    title: str
    area: str
    priority: str
    deps: list[str]
    epic: str
    lines: list[str] = field(default_factory=list)

    @property
    def issue_title(self) -> str:
        return f"[{self.id}] {self.title}"


@dataclass
class Epic:
    id: str
    name: str
    milestone: str | None
    phase: int
    description: str = ""
    stories: list[Story] = field(default_factory=list)

    @property
    def issue_title(self) -> str:
        return f"[{self.id}] {self.name}"


def parse_backlog(text: str) -> list[Epic]:
    epics: list[Epic] = []
    epic: Epic | None = None
    story: Story | None = None
    in_phase2 = False
    for raw in text.splitlines():
        line = raw.rstrip()
        if m := re.match(r"^## (E\d+) · (.+?) \((M\d)[^)]*\)$", line):
            epic = Epic(m.group(1), m.group(2), m.group(3), 1)
            epics.append(epic)
            story = None
            continue
        if line.startswith("## Fase 2"):
            in_phase2, epic, story = True, None, None
            continue
        if in_phase2:
            if m := re.match(r"^- (E\d+) · (.+?): (.+)$", line):
                epics.append(Epic(m.group(1), m.group(2), None, 2, m.group(3)))
            continue
        if m := re.match(r"^### (HU-\d+) · (.+)$", line):
            assert epic is not None, f"Historia sin épica: {line}"
            story = Story(m.group(1), m.group(2), "", "", [], epic.id)
            epic.stories.append(story)
            continue
        if story is not None:
            if m := re.match(r"^Área: (\w+) · Prioridad: (\w+) · Depende de: (.+)$", line):
                story.area, story.priority = m.group(1), m.group(2)
                story.deps = re.findall(r"HU-\d+", m.group(3))
            else:
                story.lines.append(line)
        elif epic is not None and line and not line.startswith("#"):
            epic.description = (epic.description + " " + line).strip()
    return epics


def story_body(s: Story, epic_num: int | None, nums: dict[str, int], milestone: str) -> str:
    user_story, criteria, notes = [], [], []
    for line in s.lines:
        if line.startswith("- [ ]"):
            criteria.append(line)
        elif line.startswith("Notas:"):
            notes.append(line.removeprefix("Notas:").strip())
        elif line.strip():
            user_story.append(line)
    if s.deps:
        deps = "\n".join(f"- [ ] #{nums[d]} ({d})" if d in nums else f"- [ ] {d}" for d in s.deps)
    else:
        deps = "Ninguna."
    epic_ref = f"#{epic_num} ({s.epic})" if epic_num else s.epic
    parts = [
        "## Historia de usuario", "\n".join(user_story),
        "## Criterios de aceptación", "\n".join(criteria),
    ]
    if notes:
        parts += ["## Notas técnicas", "\n\n".join(notes)]
    parts += [
        "## Depende de", deps,
        "## Contexto",
        f"- Épica: {epic_ref}\n- Hito: {milestone}\n- Área: `{s.area}` · Prioridad: {s.priority}\n"
        f"- Especificación: [`{SPEC}`](../blob/main/{SPEC})\n"
        f"- Rama sugerida: `feature/<número>-<slug>`; el PR debe incluir `Closes #<número>`.\n"
        "- Solo iniciar cuando todas las dependencias estén cerradas.",
    ]
    return "\n\n".join(parts) + "\n"


def epic_body(e: Epic, nums: dict[str, int]) -> str:
    parts = ["## Descripción", e.description or "—"]
    if e.stories:
        items = "\n".join(
            f"- [ ] #{nums[s.id]} {s.id} · {s.title}" if s.id in nums else f"- [ ] {s.id} · {s.title}"
            for s in e.stories
        )
        parts += ["## Historias", items]
    else:
        parts += ["## Historias", "Se detallan al cerrar M6 (ver sección 11.2 de la especificación)."]
    parts += ["## Referencias", f"- Especificación: [`{SPEC}`](../blob/main/{SPEC})\n- Backlog: [`Docs/BACKLOG.md`](../blob/main/Docs/BACKLOG.md)"]
    return "\n\n".join(parts) + "\n"


class GitHub:
    def __init__(self, repo: str, dry_run: bool):
        self.repo, self.dry = repo, dry_run
        self._fake = 0

    def api(self, path: str, method: str = "GET", data: dict | None = None):
        cmd = ["gh", "api", f"repos/{self.repo}/{path}", "-X", method]
        inp = None
        if data is not None:
            cmd += ["--input", "-"]
            inp = json.dumps(data)
        res = subprocess.run(cmd, input=inp, capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError(f"gh api {method} {path} falló: {res.stderr.strip() or res.stdout.strip()}")
        out = res.stdout.strip()
        return json.loads(out) if out else None

    def get_all(self, path: str) -> list:
        items, page = [], 1
        sep = "&" if "?" in path else "?"
        while True:
            batch = self.api(f"{path}{sep}per_page=100&page={page}")
            items += batch
            if len(batch) < 100:
                return items
            page += 1

    def write(self, path: str, method: str, data: dict, what: str):
        if self.dry:
            self._fake += 1
            print(f"  [dry-run] {method} {path}: {what}")
            return {"number": 10_000 + self._fake}
        result = self.api(path, method, data)
        time.sleep(1)  # evita los límites secundarios de creación de contenido
        return result


def detect_repo() -> str:
    url = subprocess.run(["git", "-C", str(ROOT), "remote", "get-url", "origin"],
                         capture_output=True, text=True).stdout.strip()
    m = re.search(r"github\.com[:/]([^/]+/[^/]+?)(?:\.git)?$", url)
    if not m:
        sys.exit("No se pudo detectar el repositorio; usa --repo owner/nombre")
    return m.group(1)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", help="owner/nombre (por defecto, el remoto origin)")
    ap.add_argument("--dry-run", action="store_true", help="muestra lo que haría sin crear nada")
    args = ap.parse_args()

    epics = parse_backlog(BACKLOG.read_text(encoding="utf-8"))
    stories = [s for e in epics for s in e.stories]
    seen: set[str] = set()
    for s in stories:
        for d in s.deps:
            if d not in seen:
                sys.exit(f"{s.id} depende de {d}, que no aparece antes en el backlog")
        seen.add(s.id)
    print(f"Backlog: {len(epics)} épicas, {len(stories)} historias")

    gh = GitHub(args.repo or detect_repo(), args.dry_run)
    print(f"Repositorio: {gh.repo}")

    # Etiquetas
    existing_labels = {l["name"] for l in gh.get_all("labels")}
    for name, (color, desc) in LABELS.items():
        if name not in existing_labels:
            gh.write("labels", "POST", {"name": name, "color": color, "description": desc}, f"etiqueta {name}")

    # Hitos
    ms_numbers = {m["title"]: m["number"] for m in gh.get_all("milestones?state=all")}
    for key, (title, desc) in MILESTONES.items():
        if title not in ms_numbers:
            ms_numbers[title] = gh.write("milestones", "POST", {"title": title, "description": desc}, f"hito {title}")["number"]

    # Issues existentes (por prefijo de título)
    nums: dict[str, int] = {}
    for it in gh.get_all("issues?state=all"):
        if "pull_request" in it:
            continue
        if m := re.match(r"^\[(E\d+|HU-\d+)\]", it["title"]):
            nums.setdefault(m.group(1), it["number"])
    if nums:
        print(f"Ya existen {len(nums)} issues del backlog; se reutilizan.")

    def ms_of(e: Epic):
        return ms_numbers[MILESTONES[e.milestone][0]] if e.milestone else None

    # 1) Épicas (cuerpo provisional)
    for e in epics:
        if e.id not in nums:
            data = {"title": e.issue_title, "body": epic_body(e, nums),
                    "labels": ["tipo:epica", f"fase:{e.phase}", "prioridad:alta" if e.phase == 1 else "prioridad:media"]}
            if ms_of(e):
                data["milestone"] = ms_of(e)
            nums[e.id] = gh.write("issues", "POST", data, e.issue_title)["number"]
            print(f"#{nums[e.id]} {e.issue_title}")

    # 2) Historias, en orden (las dependencias ya tienen número)
    for e in epics:
        for s in e.stories:
            if s.id in nums:
                continue
            data = {
                "title": s.issue_title,
                "body": story_body(s, nums.get(e.id), nums, MILESTONES[e.milestone][0]),
                "labels": ["tipo:historia", f"area:{s.area}", f"fase:{e.phase}", f"prioridad:{s.priority}"],
                "milestone": ms_of(e),
            }
            nums[s.id] = gh.write("issues", "POST", data, s.issue_title)["number"]
            print(f"#{nums[s.id]} {s.issue_title}")

    # 3) Cuerpo definitivo de las épicas con las historias enlazadas
    for e in epics:
        if e.stories:
            gh.write(f"issues/{nums[e.id]}", "PATCH", {"body": epic_body(e, nums)}, f"enlazar historias en {e.id}")

    print("Listo.")


if __name__ == "__main__":
    main()
