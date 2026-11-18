#!/usr/bin/env python3
"""Crea un MBTiles sintético para probar scripts/generar_mapa.sh sin descargar el build de
Protomaps (HU-301).

    python3 -I scripts/fixtures/crear_mbtiles_prueba.py <salida.mbtiles>

Cubre la caja SERVICE_AREA ampliada (Villagarzón, Mocoa y el corredor a Puerto Asís) en los
niveles de zoom 0 a 12. Cada tesela es un MVT vacío comprimido con gzip: pmtiles no valida el
contenido, solo la estructura, así que basta para comprobar la extracción por caja y zoom.
Solo usa la biblioteca estándar de Python.
"""

import gzip
import math
import sqlite3
import sys

# Un poco más grande que SERVICE_AREA (-77.05, 0.4, -76.3, 1.3) para que la extracción recorte.
WEST, SOUTH, EAST, NORTH = -77.5, 0.0, -76.0, 1.7
MAX_ZOOM = 12


def tile_x(lon: float, z: int) -> int:
    return int((lon + 180.0) / 360.0 * (1 << z))


def tile_y(lat: float, z: int) -> int:
    rad = math.radians(lat)
    return int((1.0 - math.asinh(math.tan(rad)) / math.pi) / 2.0 * (1 << z))


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("uso: crear_mbtiles_prueba.py <salida.mbtiles>")
    db = sqlite3.connect(sys.argv[1])
    db.executescript(
        """
        DROP TABLE IF EXISTS metadata;
        DROP TABLE IF EXISTS tiles;
        CREATE TABLE metadata (name TEXT, value TEXT);
        CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER,
                            tile_data BLOB);
        CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
        """
    )
    metadata = {
        "name": "panter-fixture",
        "format": "pbf",
        "minzoom": "0",
        "maxzoom": str(MAX_ZOOM),
        "bounds": f"{WEST},{SOUTH},{EAST},{NORTH}",
        "center": "-76.6165,1.0295,10",
        "json": '{"vector_layers":[{"id":"earth","fields":{}}]}',
        "attribution": "Fixture de pruebas de PANTER",
    }
    db.executemany("INSERT INTO metadata VALUES (?, ?)", metadata.items())
    data = gzip.compress(b"", mtime=0)
    count = 0
    for z in range(MAX_ZOOM + 1):
        for x in range(tile_x(WEST, z), tile_x(EAST, z) + 1):
            for y in range(tile_y(NORTH, z), tile_y(SOUTH, z) + 1):
                tms_y = (1 << z) - 1 - y
                db.execute("INSERT INTO tiles VALUES (?, ?, ?, ?)", (z, x, tms_y, data))
                count += 1
    db.commit()
    db.close()
    print(f"{sys.argv[1]}: {count} teselas (z0-z{MAX_ZOOM})")


if __name__ == "__main__":
    main()
