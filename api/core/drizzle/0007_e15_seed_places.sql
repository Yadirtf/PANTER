-- Migración personalizada (drizzle-kit generate --custom): lugares clave iniciales (HU-310).
-- Antes vivían fijos en packages/map-style/src/places.ts. Solo el aeropuerto tiene coordenada
-- publicada (verified = true); los demás son ESTIMACIONES de zona (verified = false) que el
-- ADMIN corrige en /admin/lugares o en la prueba de campo (HU-1102). Solo inserta si el slug no
-- existe, así que no pisa correcciones posteriores. name_search = searchKey(name) de contracts.
INSERT INTO places (slug, name, name_search, category, location, verified, source) VALUES
  ('aeropuerto-cananguchal', 'Aeropuerto Cananguchal', 'aeropuerto cananguchal', 'AIRPORT',
   ST_GeogFromText('SRID=4326;POINT(-76.6053 0.9789)'), true,
   'Coordenada publicada del aeródromo (SKVG/VGZ)'),
  ('parque-principal', 'Parque principal', 'parque principal', 'PARK',
   ST_GeogFromText('SRID=4326;POINT(-76.6165 1.0295)'), false,
   'Centro urbano de Villagarzón, sin verificar en sitio (error ≈ 300 m)'),
  ('pozo-azul', 'Pozo Azul', 'pozo azul', 'TOURISM',
   ST_GeogFromText('SRID=4326;POINT(-76.64 1.045)'), false,
   'Estimación de zona (error 5–8 km). Corregir con la ubicación real'),
  ('rio-guineo', 'Río Guineo', 'rio guineo', 'TOURISM',
   ST_GeogFromText('SRID=4326;POINT(-76.65 0.99)'), false,
   'Estimación de zona (error 5–8 km). Corregir con la ubicación real'),
  ('cascadas-de-vica', 'Cascadas de Vica', 'cascadas de vica', 'TOURISM',
   ST_GeogFromText('SRID=4326;POINT(-76.67 1.07)'), false,
   'Estimación de zona (error 5–8 km). Corregir con la ubicación real'),
  ('mohano', 'Mohano', 'mohano', 'TOURISM',
   ST_GeogFromText('SRID=4326;POINT(-76.58 0.96)'), false,
   'Estimación de zona (error 5–8 km). Corregir con la ubicación real')
ON CONFLICT (slug) DO NOTHING;
