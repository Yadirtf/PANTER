-- Migración personalizada (drizzle-kit generate --custom): habilita PostGIS antes de cualquier
-- tabla con columnas geography. En Neon la extensión está disponible sin pasos extra.
CREATE EXTENSION IF NOT EXISTS postgis;
