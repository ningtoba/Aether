import { describe, it, expect } from 'vitest';
import { GraphEditor } from './graph-editor.js';
import { WorkflowBuilder } from './workflow.js';

function makeEditor() {
  const wf = new WorkflowBuilder('g', '1.0.0')
    .agentNode('a', 'A')
    .agentNode('b', 'B')
    .connect('a', 'b')
    .withEntry('a')
    .withTerminal('b')
    .build(true);
  return new GraphEditor(wf);
}

describe('GraphEditor id integrity', () => {
  it('rejects an update-node patch that mutates the node id', () => {
    const ed = makeEditor();
    const res = ed.edit({ type: 'update-node', nodeId: 'a', patch: { id: 'x' } });
    expect(res.success).toBe(false);
    expect(res.error).toContain('id');
  });

  it('rejects an update-edge patch that mutates the edge id', () => {
    const ed = makeEditor();
    const res = ed.edit({ type: 'update-edge', edgeId: 'e-a-b', patch: { id: 'z' } });
    expect(res.success).toBe(false);
    expect(res.error).toContain('id');
  });

  it('still accepts label-changing patches', () => {
    const ed = makeEditor();
    const res = ed.edit({ type: 'update-node', nodeId: 'a', patch: { label: 'Renamed' } });
    expect(res.success).toBe(true);
  });
  it('accepts the symbolic END early-exit target the builder allows', () => {
    const wf = new WorkflowBuilder('end-wf', '1.0.0')
      .agentNode('a', 'A')
      .agentNode('b', 'B')
      .connect('a', 'b')
      .addEdge({ id: 'exit', from: 'b', to: 'END', kind: 'direct' })
      .withEntry('a')
      .withTerminal('b')
      .build();
    const validation = new GraphEditor(wf).validate();
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });
});
