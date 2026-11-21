import { describe, expect, it } from 'vitest';
import { GROUP_HOME, groupHome } from './group-home';
import { ROOT_GROUPS } from './root-group';

declare global {
  interface ImportMeta {
    /** Vite/Vitest: lista los archivos que coinciden con el patrón (sin cargarlos). */
    glob(pattern: string): Record<string, unknown>;
  }
}

/** Rutas de Expo Router presentes en src/app, p. ej. `../app/(driver)/driver.tsx`. */
const routeFiles = new Set(Object.keys(import.meta.glob('../app/**/*.tsx')));

/** Archivo de Expo Router que atiende `href` dentro de `group` (`/` → index). */
function routeFile(group: string, href: string): string {
  const name = href === '/' ? 'index' : href.slice(1);
  return `../app/${group}/${name}.tsx`;
}

describe('pantalla principal de cada grupo', () => {
  it('encuentra las rutas de la app', () => {
    expect(routeFiles.size).toBeGreaterThan(5);
  });

  it('cubre todos los grupos raíz', () => {
    expect(Object.keys(GROUP_HOME).sort()).toEqual([...ROOT_GROUPS].sort());
  });

  it.each(ROOT_GROUPS)('la ruta de %s existe dentro de su propio grupo', (group) => {
    expect(routeFiles).toContain(routeFile(group, groupHome(group)));
  });

  it('solo (auth) usa la raíz: los demás grupos tienen rutas únicas', () => {
    const others = ROOT_GROUPS.filter((g) => g !== '(auth)').map((g) => GROUP_HOME[g]);
    expect(others).not.toContain('/');
    expect(new Set(others).size).toBe(others.length);
  });
});
