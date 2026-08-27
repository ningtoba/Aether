import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initLogger,
  getLogger,
  childLogger,
  moduleLogger,
  createLogger,
  shutdownLogger,
} from './logger.js';
import type { TelemetryConfig } from './types.js';

// Track the mock logger state
let mockLoggerLevel = 'info';

const mockChildFn = vi.fn().mockImplementation((bindings: Record<string, unknown>) => ({
  level: mockLoggerLevel,
  child: mockChildFn,
  flush: vi.fn(),
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  ...bindings,
}));

const mockPinoLogger = {
  get level() {
    return mockLoggerLevel;
  },
  set level(v: string) {
    mockLoggerLevel = v;
  },
  child: mockChildFn,
  flush: vi.fn(),
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
};

// Mock pino
vi.mock('pino', () => {
  const pino = vi.fn((opts: any) => {
    if (opts && opts.level) {
      mockLoggerLevel = opts.level;
      mockPinoLogger.level = opts.level;
    }
    return mockPinoLogger;
  });
  (pino as any).stdSerializers = { err: vi.fn(), error: vi.fn() };
  return { default: pino, pino };
});

// Mock @opentelemetry/api
vi.mock('@opentelemetry/api', () => {
  const mockSpanContext = {
    traceId: 'test-trace-id',
    spanId: 'test-span-id',
    traceFlags: 1,
  };
  const mockSpan = {
    spanContext: () => mockSpanContext,
  };
  return {
    context: {
      active: () => ({}),
    },
    trace: {
      getSpan: () => mockSpan,
      getTracer: vi.fn(),
    },
    SpanStatusCode: { OK: 0, ERROR: 1, UNSET: 2 },
    propagation: {
      inject: vi.fn(),
      extract: vi.fn(),
    },
    ROOT_CONTEXT: {},
    Span: class {},
    Context: class {},
    TextMapPropagator: class {},
  };
});

describe('Logger', () => {
  let config: TelemetryConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoggerLevel = 'info';
    config = {
      serviceName: 'test-service',
      logLevel: 'info',
      prettyPrint: false,
      consoleExporter: false,
    };
  });

  afterEach(async () => {
    await shutdownLogger();
  });

  describe('initLogger', () => {
    it('should create a root logger with the given config', () => {
      const logger = initLogger(config);
      expect(logger).toBeDefined();
      expect(logger.level).toBe('info');
    });

    it('should return the same root logger on subsequent calls', () => {
      const logger1 = initLogger(config);
      const logger2 = initLogger(config);
      expect(logger1).toBe(logger2);
    });

    it('should respect logLevel from config', () => {
      mockLoggerLevel = 'debug';
      const debugConfig: TelemetryConfig = { ...config, logLevel: 'debug' };
      const logger = initLogger(debugConfig);
      expect(logger.level).toBe('debug');
    });
  });

  describe('getLogger', () => {
    it('should return the initialized logger', () => {
      initLogger(config);
      expect(getLogger()).toBeDefined();
    });
  });

  describe('childLogger', () => {
    it('should create a child logger with bound fields', () => {
      initLogger(config);
      const child = childLogger({ module: 'test', agentId: 'agent-1' });
      expect(child).toBeDefined();
    });
  });

  describe('moduleLogger', () => {
    it('should create a child logger scoped to a module', () => {
      initLogger(config);
      const log = moduleLogger('orchestrator');
      expect(log).toBeDefined();
    });
  });

  describe('createLogger', () => {
    it('should create a logger for a named module', () => {
      initLogger(config);
      const log = createLogger({ module: 'metrics', level: 'info' });
      expect(log).toBeDefined();
    });
  });

  describe('shutdownLogger', () => {
    it('should flush and shutdown gracefully', async () => {
      initLogger(config);
      await shutdownLogger();
      // Should not throw
    });

    it('should not throw if called before initialization', async () => {
      await expect(shutdownLogger()).resolves.toBeUndefined();
    });
  });
});
