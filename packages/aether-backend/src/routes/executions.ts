/**
 * Execution routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteParams } from '../router.js';
import { jsonResponse, parseBody, notFound, badRequest, payloadTooLarge } from '../utils.js';

/** Execution ID type (branded string) */
type ExecutionId = string & { __brand: 'ExecutionId' };

/** Execution plan */
interface ExecutionPlan {
  steps: Array<{
    id: string;
    type: string;
    config?: Record<string, unknown>;
  }>;
  [key: string]: unknown;
}

interface ExecutionRecord {
  id: ExecutionId;
  /**
   * Lifecycle state. NOTHING here is engine-driven: pending→running→completed
   * is advanced purely by the timer chain in startExecution (see there), and
   * cancel only flips this record's own flag. Consumers must treat status
   * transitions as simulation bookkeeping, not real execution progress.
   */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  plan?: ExecutionPlan;
  agentId?: string;
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  /** Produced by the in-memory simulator; an engine never ran this. */
  simulated: true;
}

const executions = new Map<ExecutionId, ExecutionRecord>();
/** Cap on the in-memory execution registry (no eviction exists): POSTs past
 * the cap answer 503 and never mutate the map. */
const MAX_EXECUTIONS = 500;

export async function listExecutions(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  jsonResponse(res, 200, {
    executions: Array.from(executions.values()),
  });
}

export async function startExecution(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = await parseBody<{
    agentId?: string;
    plan?: ExecutionPlan;
    input?: unknown;
  }>(req);

  if (!parsed.ok) {
    if (parsed.reason === 'too_large') return payloadTooLarge(res);
    return badRequest(res, 'Invalid request body');
  }
  const body = parsed.value;
  const { input } = body;
  // Bounded growth (same policy as the provider registry): reject past the
  // cap before anything is created, so the map is left untouched.
  if (executions.size >= MAX_EXECUTIONS) {
    jsonResponse(res, 503, { error: `execution registry full (${MAX_EXECUTIONS})` });
    return;
  }

  const id = crypto.randomUUID() as ExecutionId;
  const now = new Date().toISOString();

  const record: ExecutionRecord = {
    id,
    status: 'pending',
    agentId: body.agentId,
    plan: body.plan,
    createdAt: now,
    simulated: true,
  };

  executions.set(id, record);

  // Purely simulated lifecycle — no engine, process, or I/O is ever started.
  // A timer chain walks pending→running→completed ~2s later so the GUI has
  // something to animate; every response carries `simulated: true`.
  setImmediate(() => {
    const exec = executions.get(id);
    if (exec && exec.status === 'pending') {
      exec.status = 'running';
      exec.startedAt = new Date().toISOString();

      setTimeout(() => {
        const e = executions.get(id);
        if (e && e.status === 'running') {
          e.status = 'completed';
          e.result = { output: 'Execution completed successfully', input };
          e.completedAt = new Date().toISOString();
        }
      }, 2000);
    }
  });

  jsonResponse(res, 201, { execution: record });
}

export async function getExecution(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
): Promise<void> {
  const execution = executions.get(params.id as ExecutionId);
  if (!execution) return notFound(res, 'Execution not found');
  jsonResponse(res, 200, { execution });
}

export async function cancelExecution(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
): Promise<void> {
  const execution = executions.get(params.id as ExecutionId);
  if (!execution) return notFound(res, 'Execution not found');
  if (execution.status === 'completed' || execution.status === 'cancelled') {
    return badRequest(res, `Execution is already ${execution.status}`);
  }
  execution.status = 'cancelled';
  execution.completedAt = new Date().toISOString();
  jsonResponse(res, 200, { execution });
}
