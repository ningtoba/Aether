import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Logger } from './logger.js';

describe('Logger', () => {
  let logger: Logger;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('log levels', () => {
    it('should log debug messages when level is debug', () => {
      logger = new Logger({ level: 'debug' });
      logger.debug('debug message');
      expect(debugSpy).toHaveBeenCalled();
    });

    it('should filter out debug messages when level is info', () => {
      logger = new Logger({ level: 'info' });
      logger.debug('should not appear');
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('should filter out info messages when level is warn', () => {
      logger = new Logger({ level: 'warn' });
      logger.info('should not appear');
      expect(infoSpy).not.toHaveBeenCalled();
    });

    it('should log warn messages when level is warn', () => {
      logger = new Logger({ level: 'warn' });
      logger.warn('warning');
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should always log error messages', () => {
      logger = new Logger({ level: 'error' });
      logger.error('error msg');
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should filter out warn messages when level is error', () => {
      logger = new Logger({ level: 'error' });
      logger.warn('should not appear');
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('level ordering', () => {
    it('should have correct level hierarchy (debug < info < warn < error)', () => {
      logger = new Logger({ level: 'debug' });
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');
      expect(debugSpy).toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('setLevel', () => {
    it('should dynamically change log level', () => {
      logger = new Logger({ level: 'warn' });
      logger.info('should be filtered');
      expect(infoSpy).not.toHaveBeenCalled();

      logger.setLevel('info');
      logger.info('now visible');
      expect(infoSpy).toHaveBeenCalled();
    });
  });

  describe('child logger', () => {
    it('should create a child logger that inherits parent config', () => {
      logger = new Logger({ level: 'warn', enableJson: true, enableTimestamp: false });
      const child = logger.child('child-source');

      // Child should inherit level
      child.info('filtered');
      expect(infoSpy).not.toHaveBeenCalled();

      child.warn('test warning');
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should include source in output', () => {
      logger = new Logger({ level: 'info', enableTimestamp: false, enableJson: false });
      const child = logger.child('my-service');
      child.info('child message');

      const output = infoSpy.mock.calls[0][0];
      expect(output).toContain('[my-service]');
    });
  });

  describe('JSON output', () => {
    it('should output JSON when enableJson is true', () => {
      logger = new Logger({ level: 'info', enableJson: true, enableTimestamp: false });
      logger.info('json test', { extra: 'data' });

      const output = infoSpy.mock.calls[0][0];
      const parsed = JSON.parse(output as string);
      expect(parsed.level).toBe('info');
      expect(parsed.msg).toBe('json test');
      expect(parsed.meta).toEqual({ extra: 'data' });
    });

    it('should include source in JSON output', () => {
      logger = new Logger({
        level: 'info',
        source: 'app',
        enableJson: true,
        enableTimestamp: false,
      });
      logger.info('src test');

      const output = infoSpy.mock.calls[0][0];
      const parsed = JSON.parse(output as string);
      expect(parsed.source).toBe('app');
    });

    it('should include timestamp in JSON output', () => {
      logger = new Logger({ level: 'info', enableJson: true });
      logger.info('timestamp');

      const output = infoSpy.mock.calls[0][0];
      const parsed = JSON.parse(output as string);
      expect(parsed.timestamp).toBeDefined();
      expect(typeof parsed.timestamp).toBe('string');
    });
  });

  describe('text format', () => {
    it('should format text output with level prefix', () => {
      logger = new Logger({ level: 'info', enableTimestamp: false, enableJson: false });
      logger.info('plain message');

      const output = infoSpy.mock.calls[0][0];
      expect(output).toContain('[INFO]');
      expect(output).toContain('plain message');
    });

    it('should include source in text format', () => {
      logger = new Logger({
        level: 'info',
        source: 'myapp',
        enableTimestamp: false,
        enableJson: false,
      });
      logger.info('src in text');

      const output = infoSpy.mock.calls[0][0];
      expect(output).toContain('[myapp]');
    });

    it('should include timestamp in text format', () => {
      logger = new Logger({ level: 'info', enableTimestamp: true, enableJson: false });
      logger.info('timestamped');

      const output = infoSpy.mock.calls[0][0];
      expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    });

    it('should suppress timestamp in text format when disabled', () => {
      logger = new Logger({ level: 'info', enableTimestamp: false, enableJson: false });
      logger.info('no timestamp');

      const output = infoSpy.mock.calls[0][0];
      expect(output).not.toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    });
  });
});
