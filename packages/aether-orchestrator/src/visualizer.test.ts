import { describe, it, expect } from 'vitest';
import { toDOT } from './visualizer.js';
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
