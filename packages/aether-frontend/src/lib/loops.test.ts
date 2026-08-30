import { describe, expect, it } from 'vitest';
import type { LoopDefinition } from './api';
import { hydrateLoopFormEdit } from './loops';

function makeLoop(overrides: Partial<LoopDefinition> = {}): LoopDefinition {
  return {
    id: 'loop-1',
    name: 'Nightly audit',
    description: 'deep review',
    prompt: 'Improve this project. Round {round}:',
    transition: { kind: 'skill', skillName: 'santa-loop', args: 'focus round {round}' },
    maxRounds: 5,
    maxTimeMs: 600_000,
    cwd: '/home/user/project',
    model: { provider: 'local-server', modelId: 'deepseek-ai/DeepSeek-V4-Flash-0731' },
    ...overrides,
  };
}

describe('hydrateLoopFormEdit', () => {
  it('hydrates the cwd picker from the saved loop (regression: edit silently dropped cwd)', () => {
    const loop = makeLoop();
    const h = hydrateLoopFormEdit(loop);
    expect(h.cwd).toBe('/home/user/project');
    // save() sends { ...form, cwd, model } — the picker value is what persists.
    expect({ ...h.form, cwd: h.cwd }.cwd).toBe(loop.cwd);
  });

  it('maps identity, prompt, transition and limits into the form', () => {
    const loop = makeLoop();
    const { form } = hydrateLoopFormEdit(loop);
    expect(form.id).toBe('loop-1');
    expect(form.name).toBe('Nightly audit');
    expect(form.description).toBe('deep review');
    expect(form.prompt).toBe(loop.prompt);
    expect(form.transition).toEqual(loop.transition);
    expect(form.maxRounds).toBe(5);
    expect(form.maxTimeMs).toBe(600_000);
  });

  it('composes the model select key as provider/modelId', () => {
    const { modelKey } = hydrateLoopFormEdit(makeLoop());
    expect(modelKey).toBe('local-server/deepseek-ai/DeepSeek-V4-Flash-0731');
  });

  it('deep-copies the transition so editor edits never write into the saved list', () => {
    const loop = makeLoop();
    const { form } = hydrateLoopFormEdit(loop);
    form.transition!.kind = 'gate';
    form.transition!.skillName = undefined;
    expect(loop.transition.kind).toBe('skill');
    expect(loop.transition.skillName).toBe('santa-loop');
  });

  it('leaves optional fields undefined when the loop omits them', () => {
    const loop = makeLoop({
      description: undefined,
      maxRounds: undefined,
      maxTimeMs: undefined,
      transition: { kind: 'none' },
    });
    const h = hydrateLoopFormEdit(loop);
    expect(h.form.description).toBeUndefined();
    expect(h.form.maxRounds).toBeUndefined();
    expect(h.form.maxTimeMs).toBeUndefined();
    expect(h.form.transition).toEqual({ kind: 'none' });
    expect(h.form.transition!.args).toBeUndefined();
  });
});
