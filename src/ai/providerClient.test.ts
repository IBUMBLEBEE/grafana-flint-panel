import { DataSourceInstanceSettings } from '@grafana/data';

import { FLINT_AI_DATASOURCE_PLUGIN_ID, GrafanaAiProviderClient, listAiProviders } from './providerClient';

function settings(uid: string, name: string, type = FLINT_AI_DATASOURCE_PLUGIN_ID): DataSourceInstanceSettings {
  return { uid, name, type, jsonData: {}, access: 'proxy', readOnly: false, meta: {} as never };
}

const request = {
  prompt: 'bar',
  fields: [{ name: 'value', type: 'number' }],
  renderBackend: 'echarts' as const,
  chartCatalog: [{ chartType: 'Bar Chart', channels: ['x', 'y'] }],
  frameSummary: [{ frameIndex: 0, refId: 'A', fields: ['value'] }],
};

describe('Flint AI provider adapter', () => {
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
