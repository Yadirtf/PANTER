import { describe, expect, it } from 'vitest';
import { buildHealth } from '../src/modules/health/domain/health';
import { echoMessage } from '../src/modules/ops/domain/echo';

describe('buildHealth', () => {
  it('usa "dev" por defecto', () => {
    expect(buildHealth()).toEqual({ service: 'panter-realtime', version: 'dev', commit: 'dev' });
    expect(buildHealth('', '')).toEqual({
      service: 'panter-realtime',
      version: 'dev',
      commit: 'dev',
    });
  });

  it('refleja versión y commit', () => {
    expect(buildHealth('1.2.3', 'abc123')).toEqual({
      service: 'panter-realtime',
      version: '1.2.3',
      commit: 'abc123',
    });
  });
});

describe('echoMessage', () => {
  it('envuelve texto y binario', () => {
    expect(echoMessage('hola')).toBe('{"type":"echo","data":"hola"}');
    const bin = new TextEncoder().encode('bin').buffer as ArrayBuffer;
    expect(echoMessage(bin)).toBe('{"type":"echo","data":"bin"}');
  });
});
