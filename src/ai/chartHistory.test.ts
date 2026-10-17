import { toChartState } from '../flint/chartState';
import { applyPendingViz } from '../flint/applyPendingViz';
import {
  chartHistoryContext,
  chartHistoryKey,
  historyUnavailableReason,
  loadChartHistory,
  prepareChartRestore,
  recordChartApplication,
  saveChartHistory,
  isRestoreRequest,
} from './chartHistory';
import { validateProposalPlan } from './proposalPlan';

const context = {
  dashboardUid: 'demo',
  panelId: 6,
  bindings: [],
  schemaFingerprint: 'fields-a',
  queryFingerprints: { runtime: 'query-a' },
};
const before = toChartState({
  bindingMode: 'auto',
  flintInput: { chart_spec: { chartType: 'Grouped Bar Chart', title: 'Original', encodings: { x: 'quarter' } } },
  seriesColors: { revenue: '#0072B2', expenses: '#D55E00', profit: '#009E73' },
});
const after = toChartState({
  flintInput: {
    semantic_types: { quarter: 'Quarter', revenue: 'Amount', expenses: 'Amount', profit: 'Profit' },
    chart_spec: { chartType: 'Line Chart', encodings: { x: 'quarter', y: ['revenue', 'expenses', 'profit'] } },
  },
});

beforeEach(() => {
  sessionStorage.clear();
  let sequence = 0;
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => `revision-${++sequence}` });
});

it('prepares and applies the exact old Auto source and colors without generating it again', () => {
  const history = recordChartApplication([], before, after, context, {
    before: 'Grouped Bar Chart',
    after: 'Line Chart',
  });
  const draft = prepareChartRestore(history, history[0].id, after, context);
  expect(toChartState(draft)).toEqual(before);
  expect(after.flintInput.chart_spec.chartType).toBe('Line Chart');
  expect(draft.source).toBe('undo');
  expect(applyPendingViz({ ...after, ai: { lastPrompt: '' } }, draft)).toMatchObject(before);
  const next = recordChartApplication(
    history,
    after,
    before,
    context,
    { before: 'Line Chart', after: 'Grouped Bar Chart' },
    history[0].id
  );
  expect(next.at(-1)).toMatchObject({ action: 'restored', restoredFrom: history[0].id, snapshot: before });
});

it('retains history across editor reloads and isolates dashboards and panels', () => {
  const history = recordChartApplication([], before, after, context, {
    before: 'Grouped Bar Chart',
    after: 'Line Chart',
  });
  saveChartHistory(sessionStorage, chartHistoryKey(context), history);
  const loaded = loadChartHistory(sessionStorage, chartHistoryKey(context));
  expect(loaded).toEqual(history);
  expect(chartHistoryContext(loaded, after, context).revisions).toEqual([
    { id: history[0].id, label: 'Grouped Bar Chart', createdAt: history[0].createdAt },
  ]);
  expect(loadChartHistory(sessionStorage, chartHistoryKey({ ...context, panelId: 7 }))).toEqual([]);
  expect(chartHistoryKey(undefined)).toBeUndefined();
});

it('rejects unknown/current versions, changed queries and external chart edits', () => {
  const history = recordChartApplication([], before, after, context, { before: 'Bar', after: 'Line' });
  expect(() => prepareChartRestore(history, 'invented', after, context)).toThrow('unavailable');
  expect(() => prepareChartRestore(history, history[1].id, after, context)).toThrow('unavailable');
  expect(() =>
    prepareChartRestore(history, history[0].id, after, { ...context, queryFingerprints: { runtime: 'query-b' } })
  ).toThrow('query');
  expect(() => prepareChartRestore(history, history[0].id, before, context)).toThrow('differs');
  expect(() =>
    applyPendingViz({ ...before, ai: { lastPrompt: '' } }, prepareChartRestore(history, history[0].id, after, context))
  ).toThrow('stale');
  expect(historyUnavailableReason([], after, context)).toContain('No earlier');
});

it('bounds history and ignores corrupt or data-bearing browser snapshots', () => {
  let history = recordChartApplication([], before, after, context, { before: 'Bar', after: 'Line' });
  for (let i = 0; i < 15; i++) {
    history = recordChartApplication(history, after, after, context, { before: 'Line', after: 'Line' });
  }
  expect(history).toHaveLength(10);
  sessionStorage.setItem(
    'bad',
    JSON.stringify({
      version: 1,
      revisions: [
        {
          ...history[0],
          snapshot: { ...before, flintInput: { ...before.flintInput, data: { values: [{ revenue: 5 }] } } },
        },
      ],
    })
  );
  expect(loadChartHistory(sessionStorage, 'bad')).toEqual([]);
});

it('requires a revision ID for restore plans and recognizes explicit historical intent', () => {
  expect(
    validateProposalPlan({ mode: 'restore', summary: 'Restore previous', question: '', restoreRevisionId: 'r1' })
  ).toMatchObject({ mode: 'restore', restoreRevisionId: 'r1' });
  expect(() => validateProposalPlan({ mode: 'restore', summary: 'Restore', question: '' })).toThrow('invalid');
  expect(() =>
    validateProposalPlan({ mode: 'create', summary: 'Create', question: '', restoreRevisionId: 'r1' })
  ).toThrow('invalid');
  expect(isRestoreRequest('我点了apply，你能帮我回滚到 Grouped Bar Chart')).toBe(true);
  expect(isRestoreRequest('undo the last application')).toBe(true);
  expect(isRestoreRequest('换成 Line Chart')).toBe(false);
});

it.each(['chat', 'workbench'] as const)(
  'retains the %s notification target until Apply is confirmed after an editor reload',
  (notificationTarget) => {
    const history = recordChartApplication(
      [],
      before,
      after,
      context,
      { before: 'Bar', after: 'Line' },
      undefined,
      false,
      notificationTarget
    );
    saveChartHistory(sessionStorage, chartHistoryKey(context), history);
    const loaded = loadChartHistory(sessionStorage, chartHistoryKey(context));
    expect(loaded.at(-1)).toMatchObject({ notificationTarget, confirmed: false, snapshot: after });
  }
);
