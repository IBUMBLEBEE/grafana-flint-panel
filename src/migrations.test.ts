import { hasLegacyDataScope, migrateFlintOptions } from './migrations';

describe('Flint panel options migration', () => {
  it('removes legacy dataScope without altering visualization fields', () => {
    const panel = {
      options: {
        renderBackend: 'echarts',
        chartType: 'Bar Chart',
        xField: 'region',
        yField: 'revenue',
        colorField: '',
        specJson: '',
        dataScope: { refId: 'A', frameIndex: 0 },
        ai: {
          lastPrompt: '',
          draft: {
            chartType: 'Bar Chart',
            xField: 'region',
            yField: 'revenue',
            colorField: '',
            specJson: '',
            dataScope: { refId: 'A', frameIndex: 0 },
          },
        },
      },
    } as never;

    expect(hasLegacyDataScope(panel)).toBe(true);
    const migrated = migrateFlintOptions(panel);
    expect(migrated).not.toHaveProperty('dataScope');
    expect(migrated.ai?.draft).not.toHaveProperty('dataScope');
    expect(migrated).toMatchObject({ chartType: 'Bar Chart', xField: 'region', yField: 'revenue' });
    expect(hasLegacyDataScope({ options: migrated })).toBe(false);
  });
});
