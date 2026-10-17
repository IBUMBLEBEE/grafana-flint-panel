import { FieldType, toDataFrame } from '@grafana/data';

import { toChartState } from '../flint/chartState';
import { buildAiDiagnosticReport, createAiDiagnostics } from './diagnostics';
import { GrafanaAiProviderClient, FLINT_AI_DATASOURCE_PLUGIN_ID, type AiProviderClient } from './providerClient';
import { chartCatalogForBackend } from '../flint/chartTypes';

function provider(): AiProviderClient {
  return {
    chat: jest.fn(async () => ({ message: 'Ready' })),
    plan: jest.fn(async () => ({ mode: 'create' as const, summary: 'Stack all measures', question: '' })),
    generate: jest.fn(async () => ({ chartType: 'Stacked Bar Chart' })),
    repair: jest.fn(async () => ({ chartType: 'Stacked Bar Chart' })),
  };
}

describe('AI diagnostic export', () => {
  it('exports useful chart and conversation context without query values or copied credentials', () => {
    const frames = [
      toDataFrame({ refId: 'A', fields: [{ name: 'revenue', type: FieldType.number, values: [987654321] }] }),
    ];
    const chart = toChartState({ chartType: 'Bar Chart', yField: 'revenue' });
    const report = buildAiDiagnosticReport({
      messages: [
        { id: '1', role: 'user', content: 'Change title. Bearer copied-secret apiKey=another-secret', createdAt: 1 },
      ],
      frames,
      committed: chart,
      requests: [],
      status: {
        error: 'Invalid encodings',
        preview: { status: 'error' },
        specEditor: 'pristine',
        draftIsStale: false,
        canApply: false,
      },
      environment: { grafanaVersion: '13.2.2', pagePath: '/d/demo', userAgent: 'test' },
    });
    const serialized = JSON.stringify(report);
    expect(report).toMatchObject({
      format: 'flint-ai-diagnostics',
      version: 2,
      chart: { committed: chart },
      frames: [{ refId: 'A', rowCount: 1, fields: [{ name: 'revenue', type: 'number' }] }],
      status: { error: 'Invalid encodings' },
    });
    for (const excluded of ['987654321', 'copied-secret', 'another-secret']) {
      expect(serialized).not.toContain(excluded);
    }
    expect(frames[0].fields[0].values).toEqual([987654321]);
  });

  it('records all stages and preserves the response returned to the generation pipeline', async () => {
    const client = provider();
    const diagnostics = createAiDiagnostics(client);
    const input = { messages: [{ role: 'user' as const, content: 'Stack the chart' }] };
    expect(await diagnostics.client.chat('demo', input)).toEqual({ message: 'Ready' });
    expect(await diagnostics.client.plan('demo', input)).toMatchObject({ mode: 'create' });
    expect(diagnostics.snapshot().map((entry) => [entry.operation, entry.status])).toEqual([
      ['chat', 'success'],
      ['plan', 'success'],
    ]);
    const snapshot = diagnostics.snapshot();
    snapshot[0].status = 'error';
    expect(diagnostics.snapshot()[0].status).toBe('success');
  });

  it('captures failed and cancelled calls while rethrowing the original error', async () => {
    const client = provider();
    const failure = new Error('unsupported root encodings. Authorization: Bearer test-secret');
    client.chat = jest.fn(async () => {
      throw failure;
    });
    const diagnostics = createAiDiagnostics(client);
    await expect(diagnostics.client.chat('demo', { messages: [] })).rejects.toBe(failure);
    expect(diagnostics.snapshot()[0]).not.toHaveProperty('transmittedRequest');
    expect(diagnostics.snapshot()[0]).toMatchObject({
      status: 'error',
      error: expect.stringContaining('encodings'),
      finishedAt: expect.any(String),
    });
    expect(JSON.stringify(diagnostics.snapshot())).not.toContain('test-secret');
    const controller = new AbortController();
    controller.abort();
    await expect(diagnostics.client.chat('demo', { messages: [] }, controller.signal)).rejects.toBe(failure);
    expect(diagnostics.snapshot()[1].status).toBe('cancelled');
  });

  it('records the observed serialized request and HTTP rejection without exposing samples or mutating input', async () => {
    const failure = { status: 400, message: 'invalid generate request' };
    const generate = jest.fn(async () => {
      throw failure;
    });
    const service = {
      getList: jest.fn(),
      getInstanceSettings: jest.fn((uid: string) => ({
        uid,
        name: uid,
        type: FLINT_AI_DATASOURCE_PLUGIN_ID,
        jsonData: {},
        access: 'proxy' as const,
        readOnly: false,
        meta: {} as never,
      })),
      get: jest.fn(async () => ({ generate })),
    };
    const input = {
      prompt: 'Change title. Bearer copied-secret',
      generationMode: 'refine' as const,
      allowedPaths: ['/chart_spec/title'],
      fields: [{ name: 'revenue', type: 'number' }],
      renderBackend: 'plotly' as const,
      chartCatalog: chartCatalogForBackend('plotly'),
      semanticTypes: ['Amount'],
      sampleRows: [{ revenue: 'private-row' }],
    };
    const before = JSON.stringify(input);
    const diagnostics = createAiDiagnostics(new GrafanaAiProviderClient(service));
    await expect(diagnostics.client.generate('demo', input)).rejects.toThrow('request contract');
    const entry = diagnostics.snapshot()[0];
    expect(entry).toMatchObject({
      status: 'error',
      requestStage: 'datasource-call',
      contractVersion: 1,
      httpStatus: 400,
    });
    expect(entry.request).toHaveProperty('generationMode', 'refine');
    expect(entry.transmittedRequest).not.toHaveProperty('generationMode');
    expect(entry.transmittedRequest).not.toHaveProperty('allowedPaths');
    const serialized = JSON.stringify(entry.transmittedRequest);
    expect(serialized).not.toContain('defaultValue');
    expect(serialized).not.toContain('private-row');
    expect(serialized).not.toContain('copied-secret');
    expect(JSON.stringify(input)).toBe(before);
  });

  it('bounds the trace and removes sensitive fields and data samples at capture time', async () => {
    const diagnostics = createAiDiagnostics(provider());
    const input = {
      messages: [],
      sampleRows: [{ value: 'raw-row' }],
      secureJsonData: { apiKey: 'test-key' },
      panelContext: { fields: [], dataHint: 'Fields:\n- region (string): sample=["raw-sample"]' },
    };
    for (let i = 0; i < 22; i++) {
      await diagnostics.client.chat(String(i), input);
    }
    expect(diagnostics.snapshot()).toHaveLength(20);
    expect(diagnostics.snapshot()[0].providerUid).toBe('2');
    for (const excluded of ['raw-row', 'raw-sample', 'test-key']) {
      expect(JSON.stringify(diagnostics.snapshot())).not.toContain(excluded);
    }
    expect(input.sampleRows[0].value).toBe('raw-row');
    diagnostics.clear();
    expect(diagnostics.snapshot()).toEqual([]);
  });
});
