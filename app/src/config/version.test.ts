import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_VERSION,
  DEFAULT_APP_VERSION_CODE,
  MAX_VERSION_CODE,
  resolveVersion,
} from './version';

describe('resolveVersion', () => {
  it('usa la versión local por defecto', () => {
    expect(resolveVersion({})).toEqual({
      version: DEFAULT_APP_VERSION,
      versionCode: DEFAULT_APP_VERSION_CODE,
    });
    expect(resolveVersion({ APP_VERSION: ' ', APP_VERSION_CODE: '' })).toEqual({
      version: DEFAULT_APP_VERSION,
      versionCode: DEFAULT_APP_VERSION_CODE,
    });
  });

  it('acepta la versión del tag y el versionCode del CI', () => {
    expect(resolveVersion({ APP_VERSION: '0.3.0', APP_VERSION_CODE: '1042' })).toEqual({
      version: '0.3.0',
      versionCode: 1042,
    });
    expect(resolveVersion({ APP_VERSION: '1.0.0-rc.1' }).version).toBe('1.0.0-rc.1');
    expect(resolveVersion({ APP_VERSION: '0.1.0-staging.17' }).version).toBe('0.1.0-staging.17');
  });

  it('rechaza versiones que no son SemVer', () => {
    for (const bad of ['app-v0.3.0', 'v0.3.0', '0.3', '01.2.3', '1.2.3+build']) {
      expect(() => resolveVersion({ APP_VERSION: bad })).toThrow(/APP_VERSION inválida/);
    }
  });

  it('rechaza versionCode no enteros o fuera de rango', () => {
    for (const bad of ['abc', '-1', '1.5', '0', String(MAX_VERSION_CODE + 1)]) {
      expect(() => resolveVersion({ APP_VERSION_CODE: bad })).toThrow(/APP_VERSION_CODE/);
    }
    expect(resolveVersion({ APP_VERSION_CODE: String(MAX_VERSION_CODE) }).versionCode).toBe(
      MAX_VERSION_CODE,
    );
  });
});
