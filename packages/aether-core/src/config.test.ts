import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigManager } from './config.js';

interface TestConfig extends Record<string, unknown> {
  appName: string;
  port: number;
  debug: boolean;
}

describe('ConfigManager', () => {
  let config: ConfigManager;

  beforeEach(() => {
    config = new ConfigManager();
  });

  describe('default values', () => {
    it('should have default values when no defaults provided', () => {
      expect(config.get('theme')).toBe('dark');
      expect(config.get('language')).toBe('en');
      expect(config.get('logLevel')).toBe('info');
      expect(config.get('autoUpdate')).toBe(true);
      expect(config.get('telemetry')).toBe(false);
      expect(config.get('dataDir')).toBe('./data');
      expect(config.get('port')).toBe(8456);
      expect(config.get('host')).toBe('127.0.0.1');
    });

    it('should merge partial defaults over built-in defaults', () => {
      const custom = new ConfigManager({ port: 9000, theme: 'light' });
      expect(custom.get('port')).toBe(9000);
      expect(custom.get('theme')).toBe('light');
      expect(custom.get('language')).toBe('en'); // still default
    });

    it('should accept an empty defaults object', () => {
      const cm = new ConfigManager({});
      expect(cm.get('theme')).toBe('dark');
    });
  });

  describe('get / set', () => {
    it('should get a value by key', () => {
      expect(config.get('port')).toBe(8456);
    });

    it('should set a value by key', () => {
      config.set('port', 3000);
      expect(config.get('port')).toBe(3000);
    });

    it('should allow setting boolean values', () => {
      config.set('autoUpdate', false);
      expect(config.get('autoUpdate')).toBe(false);
    });
  });

  describe('update', () => {
    it('should update multiple values at once', () => {
      config.update({ port: 8080, host: '0.0.0.0' });
      expect(config.get('port')).toBe(8080);
      expect(config.get('host')).toBe('0.0.0.0');
      expect(config.get('theme')).toBe('dark'); // unchanged
    });

    it('should accept a partial update', () => {
      config.update({ theme: 'light' });
      expect(config.get('theme')).toBe('light');
    });
  });

  describe('getAll', () => {
    it('should return a frozen copy of all settings', () => {
      const all = config.getAll();
      expect(all.theme).toBe('dark');
      expect(all.port).toBe(8456);

      // Must be read-only
      expect(() => {
        (all as Record<string, unknown>).theme = 'light';
      }).toThrow();
    });

    it('should reflect updated values', () => {
      config.set('port', 5555);
      const all = config.getAll();
      expect(all.port).toBe(5555);
    });
  });

  describe('load', () => {
    it('should load values from a config object', () => {
      config.load({ port: 1234, theme: 'light', unknownKey: 'ignored' });
      expect(config.get('port')).toBe(1234);
      expect(config.get('theme')).toBe('light');
    });

    it('should ignore keys not in settings', () => {
      const original = config.get('port');
      config.load({ foo: 'bar' as unknown as string });
      expect(config.get('port')).toBe(original);
    });
    it('ignores prototype-polluting keys from JSON configs', () => {
      const cm = new ConfigManager();
      // JSON.parse creates an own "__proto__" data property; loading it must
      // not replace the settings object's prototype (which would let a later
      // "injected" key become loadable).
      cm.load(JSON.parse('{"__proto__":{"injected":1}}') as Record<string, unknown>);
      cm.load({ injected: 999 } as unknown as Record<string, unknown>);
      expect((cm.getAll() as Record<string, unknown>).injected).toBeUndefined();
    });
  });

  describe('reset', () => {
    it('should reset all settings to defaults', () => {
      config.set('port', 9999);
      config.set('theme', 'light');
      config.reset();
      expect(config.get('port')).toBe(8456);
      expect(config.get('theme')).toBe('dark');
    });

    it('should merge custom defaults on reset', () => {
      config.set('port', 9999);
      config.reset({ port: 3000 });
      expect(config.get('port')).toBe(3000);
      expect(config.get('theme')).toBe('dark');
    });
    it('restores constructor-provided defaults on reset', () => {
      const cm = new ConfigManager({ port: 9000, host: '0.0.0.0' });
      cm.set('port', 9999);
      cm.reset();
      // reset() must return to the defaults the manager was built with, not
      // forget the constructor overrides and fall all the way back to built-ins.
      expect(cm.get('port')).toBe(9000);
      expect(cm.get('host')).toBe('0.0.0.0');
    });
  });

  describe('toJSON', () => {
    it('should serialize settings to a formatted JSON string', () => {
      const json = config.toJSON();
      expect(json).toContain('"theme"');
      expect(json).toContain('"dark"');
      expect(json).toContain('"port"');
      expect(json).toContain('8456');
      // Should be pretty-printed with 2-space indent
      expect(json).toContain('\n  ');
    });

    it('should reflect updated values in JSON output', () => {
      config.set('port', 7777);
      const json = config.toJSON();
      expect(json).toContain('7777');
    });
  });
});
