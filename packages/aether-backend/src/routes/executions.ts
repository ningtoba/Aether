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
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  plan?: ExecutionPlan;
  agentId?: string;
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

const executions = new Map<ExecutionId, ExecutionRecord>();

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

  const id = crypto.randomUUID() as ExecutionId;
  const now = new Date().toISOString();

  const record: ExecutionRecord = {
    id,
    status: 'pending',
    agentId: body.agentId,
    plan: body.plan,
    createdAt: now,
  };

  executions.set(id, record);

  // Simulate async execution
  setImmediate(() => {
    const exec = executions.get(id);
    if (exec) {
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
