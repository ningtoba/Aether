import { describe, it, expect } from 'vitest';
import { toDOT, toMermaid, toTextTree } from './visualizer.js';
import { WorkflowBuilder } from './workflow.js';

function quoteWorkflow() {
  return new WorkflowBuilder('wf', '1.0.0', 'Workflow "Main"')
    .agentNode('gate', 'Gate Agent')
    .connectIf('gate', 'END', [{ field: 'data.status', operator: 'eq', value: 'done' }])
    .withEntry('gate')
    .withTerminal('gate')
    .build();
}

describe('toDOT escaping', () => {
  it('escapes quotes in labels without double-escaping the inserted backslashes', () => {
    const dot = toDOT(quoteWorkflow());

    // Labels/name contain quotes; the DOT string must not contain the broken
    // `\\"` sequence the old escape order produced (backslash re-escaped after
    // the quote pass) — two backslashes before a quote terminates the literal.
    expect(dot).not.toContain('\\\\"');
    expect(dot).toContain('"gate"');
    expect(dot).toContain('Workflow \\"Main\\"');
  });
});
describe('visualizer id & rendering safety', () => {
  it('quotes/escapes arbitrary node ids in Mermaid output', () => {
    const wf = new WorkflowBuilder('ids', '1.0.0')
      .addNode({ id: 'bad"id', kind: 'agent', agentName: 'a' })
      .addNode({ id: 'with space', kind: 'agent', agentName: 'b' })
      .connect('bad"id', 'with space')
      .withEntry('bad"id')
      .withTerminal('with space')
      .build();
    const out = toMermaid(wf);
    expect(out).toContain('"bad#quot;id"["');
    expect(out).toContain('"with space"["');
    expect(out).not.toContain('bad"id[');
  });

  it('highlights only the conditional edge, never linkStyle default', () => {
    const wf = new WorkflowBuilder('links', '1.0.0')
      .addNode({ id: 'start', kind: 'agent', agentName: 'a' })
      .addNode({ id: 'a', kind: 'agent', agentName: 'b' })
      .addNode({ id: 'b', kind: 'agent', agentName: 'c' })
      .connect('start', 'a')
      .connectIf('a', 'b', [{ field: 'data.x', operator: 'eq', value: 1 }])
      .withEntry('start')
      .withTerminal('b')
      .build();
    const out = toMermaid(wf);
    expect(out).toContain('linkStyle 1 stroke:#f9a825');
    expect(out).not.toContain('linkStyle default');
  });

  it('renders llm-route edges distinctly in DOT and with the standard arrow in Mermaid', () => {
    const wf = new WorkflowBuilder('llm', '1.0.0')
      .addNode({ id: 's', kind: 'agent', agentName: 'x' })
      .addNode({ id: 't', kind: 'agent', agentName: 'y' })
      .addEdge({ id: 'e', from: 's', to: 't', kind: 'llm-route', routePrompt: 'route' })
      .withEntry('s')
      .withTerminal('t')
      .build();
    const dot = toDOT(wf);
    expect(dot).toContain('style=dotted');
    expect(dot).toContain('color="#8e24aa"');
    expect(toMermaid(wf)).toContain('==>');
  });

  it('does not fabricate an [?] node for the END sentinel in the text tree', () => {
    const wf = new WorkflowBuilder('tree', '1.0.0')
      .addNode({ id: 'gate2', kind: 'agent', agentName: 'x' })
      .connectIf('gate2', 'END', [{ field: 'data.done', operator: 'eq', value: true }])
      .withEntry('gate2')
      .withTerminal('gate2')
      .build();
    const out = toTextTree(wf);
    expect(out).toContain('END (end)');
    expect(out).not.toContain('[?]');
  });

  it('uses a single merged style when a node is both entry and terminal', () => {
    const wf = new WorkflowBuilder('single', '1.0.0')
      .addNode({ id: 'only', kind: 'agent', agentName: 'a' })
      .withEntry('only')
      .withTerminal('only')
      .build();
    const count = (toMermaid(wf).match(/style "only"/g) ?? []).length;
    expect(count).toBe(1);
  });
});
