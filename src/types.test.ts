import { hasLegacyAiConfig, sanitizeAiConfig } from './types';

describe('secure AI configuration migration', () => {
  it('removes legacy browser provider settings while preserving drafts', () => {
    const legacy = {
      lastPrompt: 'show latency',
      apiKey: 'must-not-remain-in-dashboard',
      baseUrl: 'https://provider.example/v1',
      model: 'legacy-model',
      draft: { chartType: 'Line Chart', xField: 'Time', yField: 'Value', colorField: '', specJson: '' },
    };

    expect(hasLegacyAiConfig(legacy)).toBe(true);
    expect(sanitizeAiConfig(legacy)).toEqual({ lastPrompt: 'show latency', draft: legacy.draft });
  });

  it('preserves only a normalized Flint AI data source UID', () => {
    expect(sanitizeAiConfig({ lastPrompt: '', providerUid: ' provider-a ' })).toEqual({
      lastPrompt: '',
      providerUid: 'provider-a',
    });
    expect(hasLegacyAiConfig({ lastPrompt: '', providerUid: 'provider-a' })).toBe(false);
  });

  it('removes a legacy dataScope nested in a draft', () => {
    const draft = {
      chartType: 'Bar Chart',
      xField: 'region',
      yField: 'revenue',
      colorField: '',
      specJson: '',
      dataScope: { refId: 'A', frameIndex: 0 },
    };
    expect(sanitizeAiConfig({ lastPrompt: '', draft } as never).draft).not.toHaveProperty('dataScope');
  });
});
