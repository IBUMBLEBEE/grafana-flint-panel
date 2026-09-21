import { defaultFlintOptions } from '../types';
import { applyPendingViz } from './applyPendingViz';
import { clearFrameworkOverride } from './frameworkOverride';

describe('applyPendingViz', () => {
  it('persists a reviewed UI Framework override into Panel options', () => {
    const override = {
      version: 1 as const,
      backend: 'echarts' as const,
      compilerVersion: '0.5.1',
      sourceFingerprint: 'source-a',
      patch: [{ op: 'replace' as const, path: '/tooltip/trigger', value: 'item' }],
    };
    const result = applyPendingViz(defaultFlintOptions, {
      renderBackend: 'echarts',
      chartType: 'Bar Chart',
      xField: 'region',
      yField: 'revenue',
      colorField: '',
      specJson: '',
      frameworkOverrides: { echarts: override },
    });

    expect(result.frameworkOverrides?.echarts).toEqual(override);
  });

  it('clears a saved UI Framework override when the reviewed draft has none', () => {
    const result = applyPendingViz(
      {
        ...defaultFlintOptions,
        frameworkOverrides: {
          echarts: {
            version: 1,
            backend: 'echarts',
            compilerVersion: '0.5.1',
            sourceFingerprint: 'source-a',
            patch: [{ op: 'replace', path: '/tooltip/trigger', value: 'item' }],
          },
        },
      },
      {
        renderBackend: 'echarts',
        chartType: 'Bar Chart',
        xField: 'region',
        yField: 'revenue',
        colorField: '',
        specJson: '',
        frameworkOverrides: clearFrameworkOverride(undefined, 'echarts'),
      }
    );

    expect(result.frameworkOverrides?.echarts).toBeUndefined();
    expect(JSON.stringify(result.frameworkOverrides)).toBe('{}');
  });
});
