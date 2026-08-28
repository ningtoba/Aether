/**
 * Barrel export tests — verify the public `@aether/sdk` entry point really
 * re-exports the internal bridge (typed passthrough) surface, so consumers
 * do not need a direct @openai/agents dependency.
 */
import { describe, it, expect } from 'vitest';
import * as sdk from './index.js';

describe('SDK public barrel', () => {
  it('re-exports the internal bridge runtime symbols', () => {
    expect(typeof (sdk as unknown as { sdkTool?: unknown }).sdkTool).toBe('function');
    expect(typeof (sdk as unknown as { handoff?: unknown }).handoff).toBe('function');
    expect(typeof (sdk as unknown as { Agent?: unknown }).Agent).toBe('function');
    expect(typeof (sdk as unknown as { Runner?: unknown }).Runner).toBe('function');
  });
});
