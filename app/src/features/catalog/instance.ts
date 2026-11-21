// Instancias únicas del catálogo: API sobre el cliente HTTP de la app, copia en archivos y
// descripción de puntos con caché compartida por el origen y el destino.
import { httpClient } from '../auth/session/instance';
import { createCatalogApi } from './api/catalog-api';
import { createCatalogRepository } from './catalog-repository';
import { createLocationDescriber } from './describe/location-describer';
import { fileCatalogStorage } from './native/file-catalog-storage';

export const catalogApi = createCatalogApi(httpClient);
export const catalogRepository = createCatalogRepository({
  api: catalogApi,
  storage: fileCatalogStorage,
});
export const locationDescriber = createLocationDescriber({
  api: catalogApi,
  catalog: catalogRepository,
});
