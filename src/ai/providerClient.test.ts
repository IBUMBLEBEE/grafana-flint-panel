import { DataSourceInstanceSettings } from '@grafana/data';

import { FLINT_AI_DATASOURCE_PLUGIN_ID, GrafanaAiProviderClient, listAiProviders } from './providerClient';
import { toChartState } from '../flint/chartState';

function settings(uid: string, name: string, type = FLINT_AI_DATASOURCE_PLUGIN_ID): DataSourceInstanceSettings {
  return { uid, name, type, jsonData: {}, access: 'proxy', readOnly: false, meta: {} as never };
}

const request = {
  prompt: 'bar',
  fields: [{ name: 'value', type: 'number' }],
  renderBackend: 'echarts' as const,
  chartCatalog: [{ chartType: 'Bar Chart', channels: ['x', 'y'], requiredChannels: ['x', 'y'], properties: [] }],
  semanticTypes: ['Category', 'Quantity'],
  frameSummary: [{ frameIndex: 0, refId: 'A', fields: ['value'] }],
};

describe('Flint AI provider adapter', () => {
  it('plans only through the selected datasource and forwards the cancellation signal', async () => {
    const plan = jest.fn(async () => ({ mode: 'refine', summary: 'Only change colors', question: '' }));
    const service = {
      getList: jest.fn(),
      getInstanceSettings: jest.fn((uid: string) => settings(uid, uid)),
      get: jest.fn(async () => ({ plan })),
    };
    const input = { messages: [{ role: 'user' as const, content: 'Only change colors' }] };
    const signal = new AbortController().signal;
    await expect(new GrafanaAiProviderClient(service).plan('provider-a', input, signal)).resolves.toMatchObject({
      mode: 'refine',
    });
    expect(service.get).toHaveBeenCalledWith('provider-a');
    expect(plan).toHaveBeenCalledWith(input, signal);
  });

  it('requires an updated datasource for planning rather than defaulting to a chart replacement', async () => {
    const generate = jest.fn();
    const service = {
      getList: jest.fn(),
      getInstanceSettings: jest.fn((uid: string) => settings(uid, uid)),
      get: jest.fn(async () => ({ generate })),
    };
    await expect(
      new GrafanaAiProviderClient(service).plan('provider-a', {
        messages: [{ role: 'user', content: 'Change colors' }],
      })
    ).rejects.toThrow(/Update the Flint AI datasource/);
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(['create', 'refine'] as const)(
    'keeps %s host metadata out of strict datasource requests',
    async (generationMode) => {
      const currentChartState = toChartState({ renderBackend: 'echarts', chartType: 'Bar Chart' });
      const input = {
        ...request,
        prompt: 'Only change the title. Current Flint source: ' + JSON.stringify(currentChartState.flintInput),
        generationMode,
        currentChartState,
        allowedPaths: ['/chart_spec/title'],
      };
      const generate = jest.fn(async (body: object) => {
        if (Object.keys(body).some((key) => ['generationMode', 'currentChartState', 'allowedPaths'].includes(key))) {
          throw new Error('invalid generate request');
        }
        return { chartType: 'Bar Chart' };
      });
      const repair = jest.fn(async (body: { request: object }) => generate(body.request));
      const service = {
        getList: jest.fn(),
        getInstanceSettings: jest.fn((uid: string) => settings(uid, uid)),
        get: jest.fn(async () => ({ generate, repair })),
      };
      const client = new GrafanaAiProviderClient(service);
      const signal = new AbortController().signal;
      await expect(client.generate('provider-a', input, signal)).resolves.toEqual({ chartType: 'Bar Chart' });
      expect(generate).toHaveBeenCalledWith({ ...request, prompt: input.prompt }, signal);
      const repairInput = {
        request: input,
        candidate: { chartType: 'Bar Chart' },
        compileError: 'missing y',
        attempt: 1,
      };
      await expect(client.repair('provider-a', repairInput, signal)).resolves.toEqual({ chartType: 'Bar Chart' });
      expect(repair).toHaveBeenCalledWith({ ...repairInput, request: { ...request, prompt: input.prompt } }, signal);
      expect(input.currentChartState).toEqual(currentChartState);
      expect(input.generationMode).toBe(generationMode);
    }
  );

  it('keeps property UI metadata out of generate and repair requests', async () => {
    const property = {
      key: 'cornerRadius',
      type: 'continuous' as const,
      min: 0,
      max: 15,
      label: 'Corners',
      defaultValue: 0,
      step: 1,
      optionLabels: ['Default'],
    };
    const input = {
      ...request,
      chartCatalog: [{ ...request.chartCatalog[0], properties: [property] }],
    };
    const generate = jest.fn(async (body: typeof input) => {
      for (const entry of body.chartCatalog) {
        for (const property of entry.properties) {
          if (Object.keys(property).some((key) => !['key', 'type', 'min', 'max', 'options'].includes(key))) {
            throw new Error('invalid generate request');
          }
        }
      }
      return { chartType: 'Bar Chart' };
    });
    const repair = jest.fn(async (body: { request: typeof input }) => generate(body.request));
    const service = {
      getList: jest.fn(),
      getInstanceSettings: jest.fn((uid: string) => settings(uid, uid)),
      get: jest.fn(async () => ({ generate, repair })),
    };
    const client = new GrafanaAiProviderClient(service);
    await expect(client.generate('provider-a', input)).resolves.toEqual({ chartType: 'Bar Chart' });
    await expect(
      client.repair('provider-a', {
        request: input,
        candidate: { chartType: 'Bar Chart' },
        compileError: 'missing y',
        attempt: 1,
      })
    ).resolves.toEqual({ chartType: 'Bar Chart' });
    expect(generate.mock.calls[0][0].chartCatalog[0].properties[0]).toEqual({
      key: 'cornerRadius',
      type: 'continuous',
      min: 0,
      max: 15,
    });
    expect(input.chartCatalog[0].properties[0]).toEqual(property);
  });

  it('lists only Flint AI data source instances', () => {
    const service = {
      getList: jest.fn(() => [
        settings('b', 'Provider B'),
        settings('prom', 'Prometheus', 'prometheus'),
        settings('a', 'Provider A'),
      ]),
      get: jest.fn(),
      getInstanceSettings: jest.fn(),
    };

    expect(listAiProviders(service)).toEqual([
      { label: 'Provider A', value: 'a', description: undefined },
      { label: 'Provider B', value: 'b', description: undefined },
    ]);
    expect(service.getList).toHaveBeenCalledWith({ all: true, pluginId: FLINT_AI_DATASOURCE_PLUGIN_ID });
  });

  it('calls only the selected provider instance generate helper', async () => {
    const generateA = jest.fn(async () => ({ chartType: 'Bar Chart' }));
    const generateB = jest.fn(async () => ({ chartType: 'Line Chart' }));
    const service = {
      getList: jest.fn(),
      getInstanceSettings: jest.fn((uid: string) => settings(uid, uid)),
      get: jest.fn(async (uid: string) => ({ generate: uid === 'provider-a' ? generateA : generateB })),
    };
    const client = new GrafanaAiProviderClient(service);
    await expect(client.generate('provider-a', request)).resolves.toEqual({ chartType: 'Bar Chart' });
    expect(generateA).toHaveBeenCalledWith(request);
    expect(generateB).not.toHaveBeenCalled();
  });

  it('calls the selected provider repair helper with bounded compiler evidence', async () => {
    const repair = jest.fn(async () => ({ chartType: 'Bar Chart' }));
    const service = {
      getList: jest.fn(),
      getInstanceSettings: jest.fn((uid: string) => settings(uid, uid)),
      get: jest.fn(async () => ({ repair })),
    };
    const client = new GrafanaAiProviderClient(service);
    const input = {
      request,
      candidate: { chartType: 'Bar Chart', chartInput: { chart_spec: {} } },
      compileError: 'missing y encoding',
      attempt: 1,
    };

    await expect(client.repair('provider-a', input)).resolves.toEqual({ chartType: 'Bar Chart' });
    expect(repair).toHaveBeenCalledWith(input);
  });

  it('calls the selected provider chat helper without exposing datasource configuration', async () => {
    const chat = jest.fn(async () => ({ message: 'A waterfall chart shows the running total.' }));
    const service = {
      getList: jest.fn(),
      getInstanceSettings: jest.fn((uid: string) => settings(uid, uid)),
      get: jest.fn(async () => ({ chat })),
    };
    const client = new GrafanaAiProviderClient(service);
    const input = {
      messages: [{ role: 'user' as const, content: 'Why a waterfall?' }],
      panelContext: { fields: [{ name: 'value', type: 'number' }] },
    };

    await expect(client.chat('provider-a', input)).resolves.toEqual({
      message: 'A waterfall chart shows the running total.',
    });
    expect(chat).toHaveBeenCalledWith(input);
  });

  it('does not fall back when the selected provider is missing', async () => {
    const service = {
      getList: jest.fn(),
      getInstanceSettings: jest.fn(() => undefined),
      get: jest.fn(),
    };

    await expect(
      new GrafanaAiProviderClient(service).generate('deleted-provider', {
        ...request,
        prompt: 'line',
      })
    ).rejects.toThrow(/missing or inaccessible/);
    expect(service.get).not.toHaveBeenCalled();
  });

  it('shows the message from a structured Grafana resource error', async () => {
    const service = {
      getList: jest.fn(),
      getInstanceSettings: jest.fn((uid: string) => settings(uid, uid)),
      get: jest.fn(async () => ({
        generate: jest.fn(async () => Promise.reject({ message: 'AI provider response exceeded the size limit' })),
      })),
    };

    await expect(
      new GrafanaAiProviderClient(service).generate('provider-a', {
        ...request,
        prompt: 'pie',
        fields: [{ name: 'revenue', type: 'number' }],
      })
    ).rejects.toThrow('Selected Flint AI provider request failed: AI provider response exceeded the size limit');
  });
});
