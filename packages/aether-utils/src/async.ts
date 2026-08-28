/** Sleep for a given duration */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Options for retry() */
export interface RetryOptions {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoff: 'fixed' | 'exponential' | 'linear';
  retryIf?: (error: Error) => boolean;
}

/** Wraps a promise with a timeout that rejects if it doesn't settle in time */
export function withTimeout<T>(promise: Promise<T>, ms: number, msg?: string): Promise<T> {
  return Promise.race([
    promise,
    delay(ms).then(() => Promise.reject(new Error(msg ?? `Timed out after ${ms}ms`))),
  ]) as Promise<T>;
}

/** Retries a function with configurable backoff. Returns the first successful result. */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoff: 'exponential',
  },
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (options.retryIf && !options.retryIf(lastError)) throw lastError;
      if (attempt === options.maxAttempts) break;
      let delayMs: number;
      switch (options.backoff) {
        case 'fixed':
          delayMs = options.baseDelay;
          break;
        case 'linear':
          delayMs = options.baseDelay * attempt;
          break;
        case 'exponential':
        default:
          delayMs = options.baseDelay * Math.pow(2, attempt - 1);
          break;
      }
      delayMs = Math.min(delayMs, options.maxDelay);
      await delay(delayMs);
    }
  }
  throw lastError ?? new Error('Retry failed');
}

/** Runs tasks with limited concurrency. Returns results in order. */
export async function parallel<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number = 4,
): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  // Non-positive concurrency must not silently skip tasks (0 dropped every
  // task) or crash with an opaque RangeError (< 0): clamp to a single
  // sequential worker so all tasks still run.
  const capacity = Math.max(1, Math.min(concurrency, tasks.length));
  const workers = Array.from({ length: capacity }, worker);
  await Promise.all(workers);
  return results;
}

/** Races a set of promises with a safety timeout */
export async function raceWithTimeout<T>(promises: Promise<T>[], timeout: number): Promise<T> {
  return withTimeout(Promise.race(promises), timeout, 'raceWithTimeout timed out');
}
