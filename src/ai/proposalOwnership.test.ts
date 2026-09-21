import type { FlintPendingViz } from '../types';
import { proposalOwner, type SpecEditorStatus } from './proposalOwnership';

function draft(source?: FlintPendingViz['source']): FlintPendingViz {
  return {
    chartType: 'Bar Chart',
    xField: 'region',
    yField: 'revenue',
    colorField: '',
    specJson: '',
    source,
  };
}

describe('proposalOwner', () => {
  it.each<SpecEditorStatus>(['checking', 'valid', 'invalid', 'stale'])(
    'assigns %s editor work to the workbench',
    (status) => {
      expect(proposalOwner(draft('provider'), status)).toBe('workbench');
      expect(proposalOwner(undefined, status)).toBe('workbench');
    }
  );

  it('assigns a manual draft to the workbench even when the editor is pristine', () => {
    expect(proposalOwner(draft('manual'), 'pristine')).toBe('workbench');
  });

  it.each<FlintPendingViz['source']>(['auto', 'provider', 'mcp', 'undo', undefined])(
    'assigns a %s proposal to chat when the editor is pristine',
    (source) => {
      expect(proposalOwner(draft(source), 'pristine')).toBe('chat');
    }
  );

  it('has no owner without a draft or active editor', () => {
    expect(proposalOwner(undefined, 'pristine')).toBe('none');
  });
});
