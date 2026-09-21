import type { FlintPendingViz } from '../types';

export type ProposalOwner = 'none' | 'chat' | 'workbench';
export type SpecEditorStatus = 'pristine' | 'checking' | 'valid' | 'invalid' | 'stale';

/** Selects the single UI surface allowed to act on the current authoring state. */
export function proposalOwner(draft: FlintPendingViz | undefined, editorStatus: SpecEditorStatus): ProposalOwner {
  if (editorStatus !== 'pristine' || draft?.source === 'manual') {
    return 'workbench';
  }
  return draft ? 'chat' : 'none';
}
