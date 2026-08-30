/**
 * Pure loop-editor helpers.
 *
 * Lives outside LoopsPage.tsx so the form-hydration contract is unit-testable
 * without React: the cwd field silently vanished from edits here once already
 * (the picker state was never hydrated, so saving an edited loop dropped its
 * working directory), and that is exactly the class of bug a page component
 * hides from CI.
 */
import type { LoopDefinition } from './api';

export interface LoopFormHydration {
  /** Editor form state (identity/prompt/transition/limits). */
  form: Partial<LoopDefinition>;
  /** `${provider}/${modelId}` key for the model <select>. */
  modelKey: string;
  /** Working directory for the CwdPicker — MUST travel with the edit or the
   *  next save sends no cwd and the loop loses its workspace. */
  cwd: string | undefined;
}

/** Hydrate the loop editor from a saved loop definition. Pure. */
export function hydrateLoopFormEdit(loop: LoopDefinition): LoopFormHydration {
  return {
    form: {
      id: loop.id,
      name: loop.name,
      description: loop.description,
      prompt: loop.prompt,
      // Deep copy: the editor mutates transition fields (kind/skillName/args)
      // and must never write through into the list's loop object.
      transition: { ...loop.transition },
      maxRounds: loop.maxRounds,
      maxTimeMs: loop.maxTimeMs,
    },
    modelKey: `${loop.model.provider}/${loop.model.modelId}`,
    cwd: loop.cwd,
  };
}
