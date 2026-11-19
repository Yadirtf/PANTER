import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppBindings, Env } from '../../../env';
import { toErrorBody, AppError } from '../../../shared/errors/app-error';
import { createRouter } from '../../../shared/http/create-app';
import type { ServeTile, ServeTileResult } from '../application/serve-tile';
import { contentRange, unsatisfiedRange } from '../domain/http-range';
import { cacheControl } from '../domain/tile-file';

export interface TilesFactories {
  /** Arma el caso de uso con el bucket del ambiente; `waitUntil` es el del request. */
  serveTile: (env: Env, waitUntil: (promise: Promise<unknown>) => void) => ServeTile;
}

/**
 * CORS de las teselas: abierto a cualquier origen, solo lectura. Las usan la web, la app y
 * MapLibre, que no envían credenciales. Se exponen las cabeceras que necesita el protocolo
 * PMTiles para leer por rangos y revalidar.
 */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
};
const PREFLIGHT_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Range, If-None-Match, If-Match, Cache-Control',
  'access-control-max-age': '86400',
};

function errorResponse(err: AppError, extra: Record<string, string> = {}): Response {
  return Response.json(toErrorBody(err), {
    status: err.status,
    headers: { ...CORS_HEADERS, 'cache-control': 'no-store', ...extra },
  });
}

function toResponse(result: ServeTileResult, path: string): Response {
  switch (result.kind) {
    case 'not-found':
      return errorResponse(AppError.notFound(`No existe el archivo del mapa: ${path}`));
    case 'empty-glyphs':
      return new Response(null, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'content-type': result.file.contentType,
          'content-length': '0',
          'cache-control': cacheControl('asset'),
        },
      });
    case 'not-modified':
      return new Response(null, {
        status: 304,
        headers: {
          ...CORS_HEADERS,
          etag: result.info.etag,
          'cache-control': cacheControl(result.file.policy),
          'accept-ranges': 'bytes',
        },
      });
    case 'range-not-satisfiable':
      return errorResponse(
        new AppError('RANGE_NOT_SATISFIABLE', 'El rango pedido está fuera del archivo del mapa', {
          status: 416,
          details: { size: result.info.size },
        }),
        { 'content-range': unsatisfiedRange(result.info.size), 'accept-ranges': 'bytes' },
      );
    case 'content': {
      const headers: Record<string, string> = {
        ...CORS_HEADERS,
        'content-type': result.file.contentType,
        'cache-control': cacheControl(result.file.policy),
        'accept-ranges': 'bytes',
        etag: result.info.etag,
        'content-length': String(result.range ? result.range.length : result.info.size),
      };
      if (result.range) headers['content-range'] = contentRange(result.range, result.info.size);
      return new Response(result.body, { status: result.range ? 206 : 200, headers });
    }
  }
}

function waitUntilOf(c: Context<AppBindings>): (promise: Promise<unknown>) => void {
  try {
    const ctx = c.executionCtx;
    return (promise) => ctx.waitUntil(promise);
  } catch {
    // Sin ExecutionContext (app.request en pruebas): la promesa sigue sola.
    return (promise) => void promise;
  }
}

/**
 * Rutas del mapa base (HU-301): GET/HEAD /tiles/:file sobre el bucket R2 público TILES, con
 * rangos HTTP, ETag/304 y CORS abierto. `:file` admite subcarpetas (fonts/…, sprites/v4/…) y se
 * valida contra la lista blanca de domain/tile-file.ts.
 */
export function tilesRoutes(factories: TilesFactories) {
  const router = createRouter();

  router.options(
    '/tiles/:file{.+}',
    () => new Response(null, { status: 204, headers: PREFLIGHT_HEADERS }),
  );

  router.get('/tiles/:file{.+}', async (c) => {
    const path = c.req.param('file');
    let serveTile: ServeTile;
    try {
      serveTile = factories.serveTile(c.env, waitUntilOf(c));
    } catch (err) {
      if (err instanceof AppError) return errorResponse(err);
      throw err;
    }
    const result = await serveTile({
      path,
      range: c.req.header('range'),
      ifNoneMatch: c.req.header('if-none-match'),
      // Hono atiende HEAD con el manejador GET; así no se lee el cuerpo de R2.
      headOnly: c.req.method === 'HEAD',
    });
    return toResponse(result, path);
  });

  router.openAPIRegistry.registerPath({
    method: 'get',
    path: '/tiles/{file}',
    tags: ['tiles'],
    summary: 'Archivo del mapa base',
    description:
      'Mapa base público (HU-301): basemap.json (archivo vigente), panter-AAAAMMDD.pmtiles, ' +
      'fonts/<fuente>/<rango>.pbf y sprites/v4/<tema>[@2x].(json|png). Admite Range (206/416), ' +
      'If-None-Match (304) y HEAD. CORS abierto para GET y HEAD.',
    request: {
      params: z.object({
        file: z.string().openapi({ example: 'panter-20261117.pmtiles' }),
      }),
    },
    responses: {
      200: { description: 'Archivo completo' },
      206: { description: 'Rango pedido con Range' },
      304: { description: 'No cambió (If-None-Match)' },
      404: { description: 'Archivo inexistente o fuera de la lista blanca' },
      416: { description: 'Rango fuera del archivo' },
      503: { description: 'El bucket del mapa base no está configurado' },
    },
  });

  return router;
}
