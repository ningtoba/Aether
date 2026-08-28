import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as bridge from './backend-bridge.js';

describe('backend-bridge execution state machine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('completes an uncancelled execution through pending → running → completed', () => {
    const exec = bridge.startExecution({ agentId: 'a', input: 'run me' });
    expect(exec.status).toBe('pending');

    vi.runAllTimers();

    const after = bridge.getExecution(exec.id);
    expect(after?.status).toBe('completed');
    expect(after?.result).toEqual({ output: 'Execution completed successfully', input: 'run me' });
    expect(after?.startedAt).toBeDefined();
  });

  it('does not resurrect an execution cancelled while still pending', () => {
    const exec = bridge.startExecution({ agentId: 'a', input: 'x' });
    bridge.cancelExecution(exec.id);

    // Flush setImmediate and the 2s completion timer: an execution cancelled
    // before it ever started must stay cancelled, never flip back to running
    // and then completed.
    vi.runAllTimers();

    const after = bridge.getExecution(exec.id);
    expect(after?.status).toBe('cancelled');
    expect(after?.result).toBeUndefined();
    expect(after?.startedAt).toBeUndefined();
  });

  it('honours a cancel issued while the execution is running', () => {
    const exec = bridge.startExecution({});
    vi.runOnlyPendingTimers(); // fires setImmediate → running; not the 2s timer
    expect(bridge.getExecution(exec.id)?.status).toBe('running');

    bridge.cancelExecution(exec.id);
    vi.runAllTimers();
    expect(bridge.getExecution(exec.id)?.status).toBe('cancelled');
  });
});
