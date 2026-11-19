import { describe, expect, it } from 'vitest';
import { downloadStatusText, formatBytes, progressPercent } from './format';
import { formatBuildDate, offlineSummary } from './offline-summary';
import { totalFromContentRange } from './offline-types';

const MB = 1024 * 1024;

describe('formatos de la descarga sin señal', () => {
  it('tamaños con coma decimal', () => {
    expect(formatBytes(85 * MB)).toBe('85 MB');
    expect(formatBytes(85.34 * MB)).toBe('85,3 MB');
    expect(formatBytes(512 * 1024)).toBe('0,5 MB');
    expect(formatBytes(150 * MB)).toBe('150 MB');
    expect(formatBytes(1.5 * 1024 * MB)).toBe('1,5 GB');
  });

  it('porcentaje: no llega a 100 antes de terminar', () => {
    expect(progressPercent(0, 10)).toBe(0);
    expect(progressPercent(5, 10)).toBe(50);
    expect(progressPercent(9999, 10000)).toBe(99);
    expect(progressPercent(10, 10)).toBe(100);
    expect(progressPercent(1, 0)).toBe(0);
  });

  it('textos de estado', () => {
    expect(
      downloadStatusText({
        status: 'downloading',
        build: '20261118',
        phase: 'tiles',
        receivedBytes: 20 * MB,
        totalBytes: 80 * MB,
      }),
    ).toBe('Descargando 20 MB de 80 MB (25 %)');
    expect(
      downloadStatusText({
        status: 'no-space',
        build: '20261118',
        requiredBytes: 83 * MB,
        availableBytes: 40 * MB,
      }),
    ).toContain('se necesitan 83 MB libres y tienes 40 MB');
    expect(downloadStatusText({ status: 'idle' })).toBeNull();
  });

  it('fecha del build y resumen', () => {
    expect(formatBuildDate('20261118')).toBe('18/11/2026');
    expect(
      offlineSummary({
        loaded: true,
        current: null,
        latest: null,
        updateAvailable: false,
        download: { status: 'idle' },
      }),
    ).toBe('Descargar mapa para usar sin señal');
  });

  it('Content-Range de un 206', () => {
    expect(totalFromContentRange('bytes 0-2097151/48211337')).toBe(48211337);
    expect(totalFromContentRange('bytes */100')).toBeNull();
    expect(totalFromContentRange(null)).toBeNull();
  });
});
