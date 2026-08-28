import { describe, it, expect, beforeEach } from 'vitest';
import { LangGraphEngine } from './engine.js';
import { WorkflowBuilder } from './workflow.js';
import { InMemoryCheckpointManager } from './checkpoint.js';
import { GraphEditor } from './graph-editor.js';
import { toMermaid, toDOT, toTextTree } from './visualizer.js';
import type { WorkflowDefinition } from './types.js';

function linearWorkflow(name = 'linear-test'): WorkflowDefinition {
  return new WorkflowBuilder(name, '1.0.0', 'Linear Test Workflow')
    .agentNode('research', 'researcher')
    .agentNode('summarize', 'summarizer')
    .connect('research', 'summarize')
    .withEntry('research')
    .withTerminal('summarize')
    .build();
}

function branchingWorkflow(name = 'branch-test'): WorkflowDefinition {
  return new WorkflowBuilder(name, '1.0.0', 'Branching Test')
    .routerNode('router', 'Route', 'Decide path')
    .agentNode('quick', 'quick-agent')
    .agentNode('deep', 'deep-agent')
    .agentNode('final', 'final-agent')
    .connect('router', 'quick')
    .connect('router', 'deep')
    .connectIf('quick', 'final', [{ field: 'data.complexity', operator: 'eq', value: 'simple' }])
    .connectIf('deep', 'final', [{ field: 'data.complexity', operator: 'eq', value: 'complex' }])
    .withEntry('router')
    .withTerminal('final')
    .withInitialStateField('complexity', 'string', true, 'simple')
    .build();
}

function mapReduceWorkflow(name = 'mapreduce-test'): WorkflowDefinition {
  return new WorkflowBuilder(name, '1.0.0', 'Map-Reduce Test')
    .routerNode('splitter', 'Split', 'Split the input')
    .mapNode('process', 'Process')
    .reduceNode('merge', 'Merge')
    .connect('splitter', 'process')
    .connect('process', 'merge')
    .withEntry('splitter')
    .withTerminal('merge')
    .build();
}

describe('LangGraphEngine', () => {
  let engine: LangGraphEngine;
  beforeEach(() => {
    engine = new LangGraphEngine();
  });

  describe('linear execution', () => {
    it('should execute a linear workflow', async () => {
      const w = linearWorkflow();
      const r = await engine.execute(w, { topic: 'AI' });
      expect(r.status).toBe('completed');
      expect(r.nodeHistory).toHaveLength(2);
      expect(r.nodeHistory[0]!.nodeId).toBe('research');
      expect(r.nodeHistory[1]!.nodeId).toBe('summarize');
    });

    it('should preserve initial data', async () => {
      const r = await engine.execute(linearWorkflow(), { topic: 'AI', depth: 'deep' });
      expect(r.data.topic).toBe('AI');
      expect(r.data.depth).toBe('deep');
    });
  });

  describe('branching', () => {
    it('should follow simple branch', async () => {
      const r = await engine.execute(branchingWorkflow(), { complexity: 'simple' });
      expect(r.status).toBe('completed');
      const ids: string[] = r.nodeHistory.map((n: any) => n.nodeId);
      expect(ids).toContain('router');
      expect(ids).toContain('quick');
      expect(ids).toContain('final');
    });

    it('should follow complex branch', async () => {
      const r = await engine.execute(branchingWorkflow(), { complexity: 'complex' });
      expect(r.status).toBe('completed');
      const ids: string[] = r.nodeHistory.map((n: any) => n.nodeId);
      expect(ids).toContain('router');
      expect(ids).toContain('deep');
      expect(ids).toContain('final');
    });
  });

  describe('map-reduce', () => {
    it('should execute map-reduce workflow', async () => {
      const r = await engine.execute(mapReduceWorkflow(), { chunks: ['a', 'b'] });
      expect(r.status).toBe('completed');
    });
  });

  describe('WorkflowBuilder', () => {
    it('should build fluent chains', () => {
      const w = new WorkflowBuilder('fluent', '2.0.0', 'Fluent Test')
        .agentNode('start', 'A')
        .routerNode('router', 'R', 'D')
        .agentNode('a', 'B')
        .agentNode('b', 'C')
        .agentNode('end', 'D')
        .connect('start', 'router')
        .connect('router', 'a')
        .connect('router', 'b')
        .connect('a', 'end')
        .connect('b', 'end')
        .withEntry('start')
        .withTerminal('end')
        .withInitialStateField('input', 'string', true)
        .build();
      expect(w.nodes).toHaveLength(5);
      expect(w.edges).toHaveLength(5);
    });
  });

  describe('GraphEditor', () => {
    it('should add and remove nodes', () => {
      const b = new WorkflowBuilder('d', '1.0.0')
        .agentNode('a', 'A')
        .withEntry('a')
        .withTerminal('a');
      const ed = new GraphEditor(b.build(true));
      expect(
        ed.edit({ type: 'add-node', node: { id: 'b', kind: 'agent', agentName: 'B' } }).success,
      ).toBe(true);
      expect(ed.edit({ type: 'remove-node', nodeId: 'b' }).success).toBe(true);
    });
  });

  describe('Visualizer', () => {
    it('should generate Mermaid', () => {
      expect(toMermaid(linearWorkflow())).toContain('flowchart TD');
    });
    it('should generate DOT', () => {
      expect(toDOT(linearWorkflow())).toContain('digraph');
    });
  });
});
describe('conditional comparison operators', () => {
  function comparisonWorkflow() {
    return new WorkflowBuilder('cond-comparison', '1.0.0', 'Conditional Comparison')
      .routerNode('router', 'Route', 'Choose by score')
      .agentNode('high', 'high-agent')
      .agentNode('low', 'low-agent')
      .connectIf('router', 'high', [{ field: 'data.score', operator: 'gt', value: 5 }])
      .connectIf('router', 'low', [{ field: 'data.score', operator: 'lte', value: 5 }])
      .withEntry('router')
      .withTerminal('high')
      .withTerminal('low')
      .build();
  }

  it('routes through gt when the bound is exceeded', async () => {
    const engine = new LangGraphEngine();
    const result = await engine.execute(comparisonWorkflow(), { score: 7 });
    expect(result.status).toBe('completed');
    const data = result.data as Record<string, unknown>;
    expect(data['high.output']).toBeDefined();
    expect(data['low.output']).toBeUndefined();
  }, 10_000);

  it('routes through lte at the bound', async () => {
    const engine = new LangGraphEngine();
    const result = await engine.execute(comparisonWorkflow(), { score: 5 });
    expect(result.status).toBe('completed');
    const data = result.data as Record<string, unknown>;
    expect(data['low.output']).toBeDefined();
    expect(data['high.output']).toBeUndefined();
  }, 10_000);

  it('routes through lt for values below the bound', async () => {
    const engine = new LangGraphEngine();
    const wf = new WorkflowBuilder('cond-lt', '1.0.0')
      .routerNode('router', 'Route', 'Range')
      .agentNode('small', 's')
      .agentNode('big', 'b')
      .connectIf('router', 'big', [{ field: 'data.n', operator: 'gte', value: 10 }])
      .connectIf('router', 'small', [{ field: 'data.n', operator: 'lt', value: 10 }])
      .withEntry('router')
      .withTerminal('small')
      .withTerminal('big')
      .build();
    const result = await engine.execute(wf, { n: 3 });
    expect(result.status).toBe('completed');
    const data = result.data as Record<string, unknown>;
    expect(data['small.output']).toBeDefined();
    expect(data['big.output']).toBeUndefined();
  }, 10_000);
});
describe('engine state channels', () => {
  it('reports the last executed node as currentNode', async () => {
    const engine = new LangGraphEngine();
    const result = await engine.execute(linearWorkflow(), { topic: 'AI' });
    expect(result.status).toBe('completed');
    expect(result.currentNode).toBe('summarize');
  }, 10_000);

  it('reports paused when the workflow terminates on a signal node', async () => {
    const engine = new LangGraphEngine();
    const wf = new WorkflowBuilder('signal-wf', '1.0.0', 'Signal Wait')
      .agentNode('prepare', 'prep-agent')
      .addNode({ id: 'wait', kind: 'signal', label: 'Waiting for human input' })
      .connect('prepare', 'wait')
      .withEntry('prepare')
      .withTerminal('wait')
      .build();

    const result = await engine.execute(wf, {});
    expect(result.status).toBe('paused');
  }, 10_000);
});
