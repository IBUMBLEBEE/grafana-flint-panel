import { defaultFlintOptions } from './types';
import { needsChartStateMigration, migrateFlintOptions } from './migrations';

describe('Flint panel options migration', () => {
  it('migrates scalar fields and nested proposals and removes all retired fields', () => {
    const legacy = {
      ...defaultFlintOptions,
      chartType: 'Bar Chart',
      xField: 'region',
      yField: 'revenue',
      dataScope: { refId: 'A' },
      frameworkOverrides: { echarts: { patch: [] } },
      ai: {
        lastPrompt: '',
        draft: { chartType: 'Bar Chart', xField: 'region', yField: 'revenue', dataScope: {}, frameworkOverrides: {} },
      },
    };
    const migrated = migrateFlintOptions({ options: legacy });
    expect(migrated.flintInput?.chart_spec).toMatchObject({
      chartType: 'Bar Chart',
      encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
    });
    expect(migrated.ai.draft?.flintInput).toEqual(migrated.flintInput);
    expect(needsChartStateMigration({ options: migrated })).toBe(false);
    expect(migrateFlintOptions({ options: migrated })).toEqual(migrated);
    expect(JSON.stringify(migrated)).not.toMatch(/frameworkOverrides|dataScope|specJson|xField/);
    expect(legacy).toHaveProperty('frameworkOverrides');
  });

  it('preserves authored semantics and design dimensions but removes runtime dimensions', () => {
    const input = {
      semantic_types: { revenue: 'Amount' },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { x: 'region', y: 'revenue' },
        baseSize: { width: 560, height: 440 },
        canvasSize: { width: 1000, height: 800 },
      },
    };
    const migrated = migrateFlintOptions({ options: { ...defaultFlintOptions, specJson: JSON.stringify(input) } });
    expect(migrated.bindingMode).toBe('explicit');
    expect(migrated.flintInput).toMatchObject({
      semantic_types: input.semantic_types,
      chart_spec: { baseSize: input.chart_spec.baseSize },
    });
    expect(migrated.flintInput?.chart_spec).not.toHaveProperty('canvasSize');
  });

  it('preserves unrecoverable backend JSON as recovery evidence and blocks automatic conversion', () => {
    const specJson = '{"series":[{"type":"bar","data":[12]}]}';
    const migrated = migrateFlintOptions({ options: { ...defaultFlintOptions, specJson } });
    expect(migrated.recovery?.source).toBe(specJson);
    expect(migrated.recovery?.message).toMatch(/chartType/);
    expect(migrateFlintOptions({ options: migrated })).toEqual(migrated);
  });
});
