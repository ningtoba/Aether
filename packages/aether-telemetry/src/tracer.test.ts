import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startSpan, withSpan, recordSpanError, setSpanAttributes, getSpanLogContext, injectTraceContext, extractTraceContext, getTracer } from "./tracer.js";
import type { TelemetryConfig } from "./types.js";

// Mock @opentelemetry/api
let mockGetSpanImpl: () => any = () => ({
  end: vi.fn(),
  setStatus: vi.fn(),
  setAttribute: vi.fn(),
  recordException: vi.fn(),
  spanContext: () => ({
    traceId: "mock-trace-id",
    spanId: "mock-span-id",
    traceFlags: 1,
  }),
  addEvent: vi.fn(),
  isRecording: () => true,
});

const mockSpan = {
  end: vi.fn(),
  setStatus: vi.fn(),
  setAttribute: vi.fn(),
  recordException: vi.fn(),
  spanContext: () => ({
    traceId: "mock-trace-id",
    spanId: "mock-span-id",
    traceFlags: 1,
  }),
  addEvent: vi.fn(),
  isRecording: () => true,
};

const mockTracer = {
  startSpan: vi.fn(() => mockSpan),
};

vi.mock("@opentelemetry/api", () => ({
  context: {
    active: () => ({}),
  },
  trace: {
    getSpan: vi.fn(() => ({
      end: vi.fn(),
      setStatus: vi.fn(),
      setAttribute: vi.fn(),
      recordException: vi.fn(),
      spanContext: () => ({
        traceId: "mock-trace-id",
        spanId: "mock-span-id",
        traceFlags: 1,
      }),
      addEvent: vi.fn(),
      isRecording: () => true,
    })),
    getTracer: vi.fn(() => ({
      startSpan: vi.fn(() => mockSpan),
    })),
  },
  SpanStatusCode: { OK: 0, ERROR: 1, UNSET: 2 },
  Span: class {},
  Context: class {},
  propagation: {
    inject: vi.fn((_ctx: any, carrier: Record<string, string>) => {
      carrier["traceparent"] = "00-abc-xyz-01";
    }),
    extract: vi.fn(() => ({})),
  },
  ROOT_CONTEXT: {},
  TextMapPropagator: class {},
}));

// Mock @opentelemetry/resources
vi.mock("@opentelemetry/resources", () => ({
  Resource: class {
    constructor(_attrs: Record<string, unknown>) {}
  },
}));

// Mock @opentelemetry/sdk-trace-base
vi.mock("@opentelemetry/sdk-trace-base", () => ({
  BasicTracerProvider: class {
    addSpanProcessor = vi.fn();
    register = vi.fn();
    shutdown = vi.fn().mockResolvedValue(undefined);
  },
  BatchSpanProcessor: class {
    constructor(_exporter: any, _opts?: any) {}
    shutdown = vi.fn().mockResolvedValue(undefined);
  },
  SimpleSpanProcessor: class {
    constructor(_exporter: any) {}
  },
  ConsoleSpanExporter: class {},
}));

// Mock @opentelemetry/exporter-trace-otlp-proto
vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => ({
  OTLPTraceExporter: class {
    constructor(_opts: any) {}
    send = vi.fn();
    shutdown = vi.fn();
  },
}));

// Mock @opentelemetry/semantic-conventions
vi.mock("@opentelemetry/semantic-conventions", () => ({
  ATTR_SERVICE_NAME: "service.name",
  ATTR_SERVICE_VERSION: "service.version",
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT: "deployment.environment",
}));

// Mock @opentelemetry/core
vi.mock("@opentelemetry/core", () => ({
  W3CTraceContextPropagator: class {
    inject = vi.fn();
    extract = vi.fn();
  },
}));

describe("Tracer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getTracer", () => {
    it("should return a tracer instance", () => {
      const tracer = getTracer();
      expect(tracer).toBeDefined();
    });

    it("should accept custom name and version", () => {
      const tracer = getTracer("custom-scope", "1.0.0");
      expect(tracer).toBeDefined();
    });
  });

  describe("startSpan", () => {
    it("should start a span with the given name", () => {
      const span = startSpan("test.operation");
      expect(span).toBeDefined();
    });

    it("should forward options to the tracer", () => {
      startSpan("test.op", { attributes: { key: "value" } });
      // The mock tracer's startSpan was called
    });
  });

  describe("withSpan", () => {
    it("should run the function and end the span on success", async () => {
      const fn = vi.fn().mockResolvedValue("result");
      const result = await withSpan("test.op", fn);

      expect(result).toBe("result");
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 0 }); // OK
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it("should record error on rejection and re-throw", async () => {
      const error = new Error("test error");
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withSpan("test.op", fn)).rejects.toThrow("test error");
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({ code: 1 }), // ERROR
      );
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });
  });

  describe("recordSpanError", () => {
    it("should record an Error object with structured info", () => {
      const error = new Error("something broke");
      recordSpanError(mockSpan as any, error);

      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith("error.type", "Error");
      expect(mockSpan.setAttribute).toHaveBeenCalledWith("error.message", "something broke");
    });

    it("should handle non-Error objects", () => {
      recordSpanError(mockSpan as any, "string error");

      expect(mockSpan.recordException).toHaveBeenCalledWith("string error");
      expect(mockSpan.setAttribute).toHaveBeenCalledWith("error.type", "string");
    });
  });

  describe("setSpanAttributes", () => {
    it("should set multiple attributes in bulk", () => {
      setSpanAttributes(mockSpan as any, { agentId: "a1", sessionId: "s1" });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith("agentId", "a1");
      expect(mockSpan.setAttribute).toHaveBeenCalledWith("sessionId", "s1");
    });

    it("should skip null and undefined values", () => {
      setSpanAttributes(mockSpan as any, { key1: "val", key2: null, key3: undefined });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith("key1", "val");
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith("key2", expect.anything());
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith("key3", expect.anything());
    });
  });

  describe("getSpanLogContext", () => {
    it("should return span context when a span is active", () => {
      const ctx = getSpanLogContext();
      expect(ctx).toBeDefined();
      expect(ctx!.traceId).toBe("mock-trace-id");
      expect(ctx!.spanId).toBe("mock-span-id");
    });
  });

  describe("injectTraceContext", () => {
    it("should inject trace context into a carrier", () => {
      const carrier = injectTraceContext({});
      expect(carrier["traceparent"]).toBeDefined();
    });
  });

  describe("extractTraceContext", () => {
    it("should extract trace context from a carrier", () => {
      const ctx = extractTraceContext({ traceparent: "00-abc-xyz-01" });
      expect(ctx).toBeDefined();
    });
  });
});
