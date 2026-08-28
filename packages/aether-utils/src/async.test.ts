import { describe, it, expect, vi } from 'vitest';
import { delay, withTimeout, retry, parallel, raceWithTimeout } from './async.js';

describe('delay', () => {
  it('should resolve after approximately the given milliseconds', async () => {
    const start = Date.now();
    await delay(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it('should resolve with undefined', async () => {
    const result = await delay(10);
    expect(result).toBeUndefined();
  });

  it('should handle 0ms delay', async () => {
    await expect(delay(0)).resolves.toBeUndefined();
  });
});

describe('withTimeout', () => {
  it('should resolve when the promise resolves in time', async () => {
    const result = await withTimeout(
      delay(10).then(() => 'done'),
      100,
    );
    expect(result).toBe('done');
  });

  it('should reject when the promise takes too long', async () => {
    await expect(
      withTimeout(
        delay(200).then(() => 'done'),
        50,
      ),
    ).rejects.toThrow('Timed out after 50ms');
  });

  it('should use custom error message', async () => {
    await expect(
      withTimeout(
        delay(200).then(() => 'done'),
        50,
        'custom timeout',
      ),
    ).rejects.toThrow('custom timeout');
  });
});

describe('retry', () => {
  it('should succeed on the first try', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retry(fn, {
      maxAttempts: 3,
      baseDelay: 10,
      maxDelay: 100,
      backoff: 'fixed',
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should exhaust all attempts and throw on persistent failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(
      retry(fn, { maxAttempts: 3, baseDelay: 10, maxDelay: 100, backoff: 'fixed' }),
    ).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should succeed on retry after failures', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');

    const result = await retry(fn, {
      maxAttempts: 3,
      baseDelay: 10,
      maxDelay: 100,
      backoff: 'fixed',
    });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should use retryIf to skip retrying certain errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));
    await expect(
      retry(fn, {
        maxAttempts: 3,
        baseDelay: 10,
        maxDelay: 100,
        backoff: 'fixed',
        retryIf: (err) => err.message !== 'fatal',
      }),
    ).rejects.toThrow('fatal');
    // Only called once since retryIf returns false
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry only for specific errors with retryIf', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('retryable')).mockResolvedValue('ok');

    const result = await retry(fn, {
      maxAttempts: 3,
      baseDelay: 10,
      maxDelay: 100,
      backoff: 'fixed',
      retryIf: (err) => err.message === 'retryable',
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should use default options when none provided', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retry(fn);
    expect(result).toBe('ok');
  });
});

describe('backoff strategies', () => {
  it('should use fixed backoff', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(
      retry(fn, { maxAttempts: 3, baseDelay: 10, maxDelay: 1000, backoff: 'fixed' }),
    ).rejects.toThrow();
    // Fixed: 10ms each retry
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should use linear backoff', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(
      retry(fn, { maxAttempts: 3, baseDelay: 10, maxDelay: 1000, backoff: 'linear' }),
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should use exponential backoff', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(
      retry(fn, { maxAttempts: 3, baseDelay: 10, maxDelay: 1000, backoff: 'exponential' }),
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should cap delay at maxDelay', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(
      retry(fn, { maxAttempts: 4, baseDelay: 1000, maxDelay: 1500, backoff: 'exponential' }),
    ).rejects.toThrow();
    // Attempt 1: 1000, Attempt 2: 2000 capped to 1500, Attempt 3: 4000 capped to 1500
    expect(fn).toHaveBeenCalledTimes(4);
  });
});

describe('parallel', () => {
  it('should run all tasks and return results in order', async () => {
    const results = await parallel([async () => 1, async () => 2, async () => 3], 2);
    expect(results).toEqual([1, 2, 3]);
  });

  it('should respect concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 5 }, (_, i) => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await delay(30);
      concurrent--;
      return i;
    });

    const results = await parallel(tasks, 2);
    expect(results).toEqual([0, 1, 2, 3, 4]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('should handle empty task list', async () => {
    const results = await parallel([], 5);
    expect(results).toEqual([]);
  });

  it('should handle concurrency larger than task count', async () => {
    const results = await parallel([async () => 'a', async () => 'b'], 10);
    expect(results).toEqual(['a', 'b']);
  });
});
describe('parallel() concurrency guards', () => {
  it('still runs all tasks when concurrency is 0 (no silent drop)', async () => {
    const spy = vi.fn(async () => 42);
    const results = await parallel([spy, spy], 0);
    expect(results).toEqual([42, 42]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('runs all tasks sequentially for negative concurrency instead of RangeError', async () => {
    const results = await parallel([async () => 1, async () => 2], -3);
    expect(results).toEqual([1, 2]);
  });
});

describe('raceWithTimeout', () => {
  it('should return the first resolved promise', async () => {
    const result = await raceWithTimeout(
      [delay(50).then(() => 'slow'), delay(20).then(() => 'fast')],
      200,
    );
    expect(result).toBe('fast');
  });

  it('should reject if no promise resolves in time', async () => {
    await expect(raceWithTimeout([delay(200).then(() => 'too slow')], 50)).rejects.toThrow(
      'raceWithTimeout timed out',
    );
  });
});
describe('withTimeout timer hygiene', () => {
  it('clears its timer when the promise wins the race', async () => {
    vi.useFakeTimers();
    try {
      const result = await withTimeout(Promise.resolve('fast'), 60_000);
      expect(result).toBe('fast');
      // No pending timer may remain after the race settles.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still rejects when the timeout fires', async () => {
    vi.useFakeTimers();
    try {
      const p = withTimeout(new Promise(() => {}), 1000, 'too slow');
      const assertion = expect(p).rejects.toThrow('too slow');
      vi.advanceTimersByTime(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
