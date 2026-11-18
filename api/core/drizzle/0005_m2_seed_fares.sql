-- Migración personalizada (drizzle-kit generate --custom): valores iniciales de tarifas y
-- geocercas (RF-05, HU-401). Son editables por ADMIN en la web (HU-403); esta migración solo
-- inserta si no existen, así que no pisa cambios posteriores.
--
-- Valores de la especificación: base $3.000 mototaxi y $6.000 taxi, recargo nocturno desde las
-- 8:00 p. m., recargo aeroportuario de $5.000. Los que la especificación no fija (recargo
-- nocturno, valor por km y por minuto, recargo periférico, horario de fin de la noche) son
-- valores de arranque A CONFIRMAR con la operación antes del piloto.
--
-- Geocercas: polígonos aproximados que se ajustan en la prueba de campo (HU-1102).

INSERT INTO fare_rules (
  vehicle_type, pricing_model, base_fare, per_km, per_minute, minimum_fare,
  night_surcharge, night_start_minute, night_end_minute, round_to
) VALUES
  -- Mototaxi urbano: tarifa plana diurna/nocturna (§1.1).
  ('MOTOTAXI', 'FLAT',    3000,    0,   0,  3000, 1000, 1200, 300, 100),
  -- Taxi: banderazo + distancia + tiempo, con mínima (§1.1).
  ('TAXI',     'METERED', 6000, 1200, 150,  6000, 2000, 1200, 300, 100),
  -- Campero 4x4 (Fase 2): se deja inactivo hasta definir su esquema por destino.
  ('JEEP_4X4', 'METERED', 15000, 2500, 0, 30000, 5000, 1200, 300, 1000)
ON CONFLICT (vehicle_type) DO NOTHING;
--> statement-breakpoint
UPDATE fare_rules SET active = false WHERE vehicle_type = 'JEEP_4X4' AND updated_by IS NULL;
--> statement-breakpoint
INSERT INTO geofences (id, name, kind, area, surcharge, applies_to)
SELECT * FROM (VALUES
  (
    '6c1f8a2e-0b7d-4f3a-9c51-1a2b3c4d5e01'::uuid,
    'Aeropuerto Cananguchal (VGZ)',
    'AIRPORT'::geofence_kind,
    ST_GeogFromText('SRID=4326;POLYGON((-76.612 0.972, -76.598 0.972, -76.598 0.986, -76.612 0.986, -76.612 0.972))'),
    5000,
    ARRAY['TAXI', 'MOTOTAXI']::vehicle_type[]
  ),
  (
    '6c1f8a2e-0b7d-4f3a-9c51-1a2b3c4d5e02'::uuid,
    'Zona periférica de Villagarzón',
    'PERIPHERAL'::geofence_kind,
    -- Anillo exterior y hueco (casco urbano): el recargo aplica en los barrios periféricos.
    ST_GeogFromText('SRID=4326;POLYGON((-76.650 1.000, -76.585 1.000, -76.585 1.060, -76.650 1.060, -76.650 1.000), (-76.628 1.020, -76.628 1.040, -76.605 1.040, -76.605 1.020, -76.628 1.020))'),
    1000,
    ARRAY['MOTOTAXI']::vehicle_type[]
  )
) AS seed(id, name, kind, area, surcharge, applies_to)
WHERE NOT EXISTS (SELECT 1 FROM geofences g WHERE g.id = seed.id);
