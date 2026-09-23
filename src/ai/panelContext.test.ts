import { FieldType, toDataFrame, type DataQueryRequest, type EventBus } from '@grafana/data';

import {
  buildPanelContextSnapshot,
  describePanelContext,
  isSamePanelContext,
  loadCurrentPanelContextSnapshot,
  mergePanelContextSnapshots,
  registerPanelQueryContext,
  subscribePanelQueryContext,
} from './panelContext';

function request(): DataQueryRequest {
  return {
    requestId: 'request-1',
    interval: '1m',
    intervalMs: 60000,
    range: {} as DataQueryRequest['range'],
    scopedVars: {},
    targets: [
      {
        refId: 'A',
        datasource: { uid: 'prometheus-prod', type: 'prometheus' },
      },
    ],
    timezone: 'browser',
    app: 'dashboard',
    panelId: 12,
    dashboardUID: 'ops-overview',
    startTime: 1,
  };
}

describe('Panel query context snapshots', () => {
  it('binds a frame to its exact Grafana datasource and query target', () => {
    const eventBus = {} as EventBus;
    const frame = toDataFrame({
      refId: 'A',
      fields: [{ name: 'value', type: FieldType.number, values: [1] }],
    });
    registerPanelQueryContext(eventBus, 12, request());

    const context = buildPanelContextSnapshot([frame], eventBus);

    expect(context).toEqual(
      expect.objectContaining({
        dashboardUid: 'ops-overview',
        panelId: 12,
        bindings: [
          {
            refId: 'A',
            frameIndex: 0,
            datasource: { uid: 'prometheus-prod', type: 'prometheus' },
            fields: [{ name: 'value', type: 'number' }],
          },
        ],
        schemaFingerprint: expect.stringMatching(/^fnv1a-/),
        queryFingerprints: { runtime: expect.stringMatching(/^fnv1a-/) },
      })
    );
    expect(describePanelContext(context, 1)).toContain('datasource=prometheus-prod (prometheus)');
  });

  it('keeps frame evidence when Grafana does not expose a datasource binding', () => {
    const frame = toDataFrame({ fields: [{ name: 'value', type: FieldType.number, values: [1] }] });
    const context = buildPanelContextSnapshot([frame]);
    expect(context?.bindings).toEqual([{ frameIndex: 0, fields: [{ name: 'value', type: 'number' }] }]);
    expect(describePanelContext(context, 1)).toContain('managed by Grafana Panel');
  });

  it('changes immutable evidence when datasource provenance is hydrated', () => {
    const frame = toDataFrame({ refId: 'A', fields: [{ name: 'value', type: FieldType.number, values: [1] }] });
    const withoutDatasource = buildPanelContextSnapshot([frame]);
    const eventBus = {} as EventBus;
    registerPanelQueryContext(eventBus, 12, request());
    const withDatasource = buildPanelContextSnapshot([frame], eventBus);

    expect(withDatasource?.bindings[0].datasource).toBeDefined();
    expect(withDatasource?.schemaFingerprint).not.toBe(withoutDatasource?.schemaFingerprint);
  });

  it('detects a query change while ignoring request timing metadata', () => {
    const frame = toDataFrame({ refId: 'A', fields: [{ name: 'value', type: FieldType.number, values: [1] }] });
    const firstBus = {} as EventBus;
    const secondBus = {} as EventBus;
    const first = request();
    const second = request();
    second.requestId = 'another-request';
    second.startTime = 999;
    registerPanelQueryContext(firstBus, 12, first);
    registerPanelQueryContext(secondBus, 12, second);
    expect(
      isSamePanelContext(buildPanelContextSnapshot([frame], firstBus), buildPanelContextSnapshot([frame], secondBus))
    ).toBe(true);

    second.targets[0] = { ...second.targets[0], queryType: 'different' };
    registerPanelQueryContext(secondBus, 12, second);
    expect(
      isSamePanelContext(buildPanelContextSnapshot([frame], firstBus), buildPanelContextSnapshot([frame], secondBus))
    ).toBe(false);
  });

  it('detects a schema change as stale context', () => {
    const first = toDataFrame({
      refId: 'A',
      fields: [{ name: 'value', type: FieldType.number, values: [1] }],
    });
    const second = toDataFrame({
      refId: 'A',
      fields: [{ name: 'renamed', type: FieldType.number, values: [1] }],
    });
    const eventBus = {} as EventBus;
    registerPanelQueryContext(eventBus, 12, request());
    expect(
      isSamePanelContext(buildPanelContextSnapshot([first], eventBus), buildPanelContextSnapshot([second], eventBus))
    ).toBe(false);
  });

  it('treats the datasource UID as part of immutable field provenance', () => {
    const frame = toDataFrame({ refId: 'A', fields: [{ name: 'value', type: FieldType.number, values: [1] }] });
    const firstBus = {} as EventBus;
    const secondBus = {} as EventBus;
    const first = request();
    const second = request();
    second.targets[0] = { ...second.targets[0], datasource: { uid: 'prometheus-staging', type: 'prometheus' } };
    registerPanelQueryContext(firstBus, 12, first);
    registerPanelQueryContext(secondBus, 12, second);

    expect(
      isSamePanelContext(buildPanelContextSnapshot([frame], firstBus), buildPanelContextSnapshot([frame], secondBus))
    ).toBe(false);
  });

  it('retains both saved and runtime query evidence when snapshots are merged', () => {
    const frame = toDataFrame({ refId: 'A', fields: [{ name: 'value', type: FieldType.number, values: [1] }] });
    const eventBus = {} as EventBus;
    registerPanelQueryContext(eventBus, 12, request());
    const runtime = buildPanelContextSnapshot([frame], eventBus)!;
    const saved = { ...runtime, queryFingerprints: { saved: 'saved-query' } };

    expect(mergePanelContextSnapshots(saved, runtime)?.queryFingerprints).toEqual({
      runtime: expect.stringMatching(/^fnv1a-/),
      saved: 'saved-query',
    });
  });

  it('hydrates a non-mixed query datasource from the persisted Grafana panel', async () => {
    const eventBus = {} as EventBus;
    const input = request();
    input.targets[0].datasource = undefined;
    const frame = toDataFrame({
      refId: 'A',
      fields: [{ name: 'value', type: FieldType.number, values: [1] }],
    });
    const changed = new Promise<void>((resolve) => {
      const unsubscribe = subscribePanelQueryContext(eventBus, () => {
        if (buildPanelContextSnapshot([frame], eventBus)?.bindings[0]?.datasource) {
          unsubscribe();
          resolve();
        }
      });
    });

    registerPanelQueryContext(eventBus, 12, input, async () => ({
      dashboard: {
        panels: [
          {
            id: 12,
            datasource: { uid: 'persisted-ds', type: 'prometheus' },
            targets: [{ refId: 'A' }],
          },
        ],
      },
    }));
    await changed;

    expect(buildPanelContextSnapshot([frame], eventBus)?.bindings[0].datasource).toEqual({
      uid: 'persisted-ds',
      type: 'prometheus',
    });
  });

  it('returns no saved context outside a dashboard panel route', async () => {
    await expect(loadCurrentPanelContextSnapshot([], async () => ({}))).resolves.toBeUndefined();
  });
});
