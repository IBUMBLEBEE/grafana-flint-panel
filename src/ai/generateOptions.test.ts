import { FieldType, toDataFrame } from '@grafana/data';

import { applyGeneratedOptions, generateFlintOptionsFromAi } from './generateOptions';
import type { GenerateChartRequest, RepairChartRequest } from './providerClient';

describe('generateFlintOptionsFromAi', () => {
  const frame = toDataFrame({
    fields: [
      { name: 'region', type: FieldType.string, values: ['North'] },
      { name: 'revenue', type: FieldType.number, values: [120] },
    ],
  });
  it('parses model JSON into Flint options', async () => {
    const generate = jest.fn(async () => ({
      chartType: 'Bar Chart',
      xField: 'region',
      yField: 'revenue',
      colorField: '',
      specJson: '',
      rationale: 'category vs measure',
    }));

    const generated = await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [frame],
      userPrompt: 'bar chart please',
      client: { generate },
    });

    expect(generated.chartType).toBe('Bar Chart');
    expect(generated.xField).toBe('region');
    expect(generated.rationale).toContain('category');
    expect(generate).toHaveBeenCalledWith(
      'provider-a',
      expect.objectContaining({
        prompt: 'bar chart please',
        fields: [
          { name: 'region', type: 'string' },
          { name: 'revenue', type: 'number' },
        ],
        semanticTypes: expect.arrayContaining(['Category', 'Amount', 'DateTime']),
        sampleRows: [{ region: 'North', revenue: 120 }],
        chartCatalog: expect.arrayContaining([
          expect.objectContaining({
            chartType: 'Bar Chart',
            requiredChannels: ['x', 'y'],
            properties: expect.any(Array),
          }),
        ]),
      })
    );
  });

  it('normalizes common chartType aliases from models', async () => {
    const generate = jest.fn(async () => ({ chartType: 'bar', xField: 'region', yField: 'revenue' }));

    const generated = await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [frame],
      userPrompt: 'bar',
      client: { generate },
    });

    expect(generated.chartType).toBe('Bar Chart');
  });

  it('normalizes a Waterfall chart alias from models', async () => {
    const generate = jest.fn(async () => ({ chartType: 'waterfall', xField: 'region', yField: 'revenue' }));

    const generated = await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [frame],
      userPrompt: 'waterfall',
      client: { generate },
    });

    expect(generated.chartType).toBe('Waterfall Chart');
  });

  it('keeps a usable proposal when an OpenAI-compatible model adds a non-Flint specJson', async () => {
    const generate = jest.fn(async () => ({
      chartType: 'bar',
      xField: 'region',
      yField: 'revenue',
      specJson:
        '{"mark":"bar","encoding":{"x":{"field":"region","type":"nominal"},"y":{"field":"revenue","type":"quantitative"}}}',
      rationale: 'Bar chart is appropriate for comparing revenue across regions.',
    }));

    const generated = await generateFlintOptionsFromAi({
      providerUid: 'flint-ai-demo',
      frames: [frame],
      userPrompt: '为 region 和 revenue 绘制柱状图',
      client: { generate },
    });

    expect(generated).toEqual(
      expect.objectContaining({
        chartType: 'Bar Chart',
        xField: 'region',
        yField: 'revenue',
        specJson: '',
      })
    );
    expect(generated.rationale).toContain('Advanced Flint input was rejected');
    expect(generated.fallbackReason).toMatch(/chart_spec requires chartType/);
  });

  it('preserves a valid Flint specJson from the model', async () => {
    const specJson = JSON.stringify({
      chartType: 'Bar Chart',
      encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
    });
    const generate = jest.fn(async () => ({
      chartType: 'bar',
      xField: 'region',
      yField: 'revenue',
      specJson,
    }));

    const generated = await generateFlintOptionsFromAi({
      providerUid: 'flint-ai-demo',
      frames: [frame],
      userPrompt: 'bar',
      client: { generate },
    });

    expect(generated.specJson).toBe(specJson);
  });

  it('accepts a structured data-free chartInput after a real Flint compile', async () => {
    const chartInput = {
      semantic_types: { region: 'Category', revenue: 'Amount' },
      chart_spec: {
        chartType: 'Bar Chart',
        title: 'Revenue differs by region',
        encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
        chartProperties: { cornerRadius: 4 },
      },
    };
    const generate = jest.fn(async () => ({
      chartType: 'Bar Chart',
      xField: 'region',
      yField: 'revenue',
      chartInput,
      specJson: '{"legacy":true}',
    }));

    const generated = await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [frame],
      userPrompt: 'rounded bars with a headline',
      client: { generate },
    });

    expect(JSON.parse(generated.specJson)).toEqual(chartInput);
    expect(generated.fallbackReason).toBeUndefined();
  });

  it.each(['echarts', 'vegalite', 'plotly', 'chartjs'] as const)(
    'compiles accepted advanced input with the real %s runtime catalog',
    async (renderBackend) => {
      let providerRequest: GenerateChartRequest | undefined;
      const generate = jest.fn(async (_providerUid: string, request: GenerateChartRequest) => {
        providerRequest = request;
        return {
          chartType: 'Bar Chart',
          xField: 'region',
          yField: 'revenue',
          chartInput: {
            semantic_types: { region: 'Category', revenue: 'Amount' },
            chart_spec: {
              chartType: 'Bar Chart',
              encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
            },
          },
        };
      });

      const generated = await generateFlintOptionsFromAi({
        providerUid: 'provider-a',
        frames: [frame],
        userPrompt: 'advanced bar',
        renderBackend,
        client: { generate },
      });

      expect(generated.specJson).toContain('chart_spec');
      expect(providerRequest?.chartCatalog.find((entry) => entry.chartType === 'Bar Chart')).toEqual(
        expect.objectContaining({ requiredChannels: ['x', 'y'], properties: expect.any(Array) })
      );
    }
  );

  it('sends an exact compile error through one repair attempt and accepts the repaired input', async () => {
    const generate = jest.fn(async () => ({
      chartType: 'Bar Chart',
      xField: 'region',
      yField: 'revenue',
      chartInput: {
        chart_spec: {
          chartType: 'Bar Chart',
          encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
          chartProperties: { cornerRadius: 99 },
        },
      },
    }));
    let repairRequest: RepairChartRequest | undefined;
    const repair = jest.fn(async (_providerUid: string, request: RepairChartRequest) => {
      repairRequest = request;
      return {
        chartType: 'Bar Chart',
        xField: 'region',
        yField: 'revenue',
        chartInput: {
          chart_spec: {
            chartType: 'Bar Chart',
            encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
            chartProperties: { cornerRadius: 5 },
          },
        },
      };
    });

    const generated = await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [frame],
      userPrompt: 'rounded bars',
      client: { generate, repair },
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(repairRequest).toEqual(
      expect.objectContaining({
        attempt: 1,
        compileError: expect.stringMatching(/cornerRadius.*between 0 and 15/),
      })
    );
    expect(JSON.parse(generated.specJson).chart_spec.chartProperties.cornerRadius).toBe(5);
    expect(generated.repairAttempts).toBe(1);
  });

  it('surfaces the reason when repair fails and explicitly falls back to scalar fields', async () => {
    const generate = jest.fn(async () => ({
      chartType: 'Bar Chart',
      xField: 'region',
      yField: 'revenue',
      chartInput: {
        chart_spec: {
          chartType: 'Bar Chart',
          encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
          chartProperties: { cornerRadius: 99 },
        },
      },
    }));
    const repair = jest.fn(async () => Promise.reject(new Error('provider could not repair the candidate')));

    const generated = await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [frame],
      userPrompt: 'rounded bars',
      client: { generate, repair },
    });

    expect(generated.specJson).toBe('');
    expect(generated.fallbackReason).toMatch(/cornerRadius.*repair failed.*could not repair/);
    expect(generated.rationale).toContain('Using the validated chart and field selections instead');
  });

  it('maps a donut proposal to Pie Chart and drops its unsupported spec override', async () => {
    const generate = jest.fn(async () => ({
      chartType: 'Donut Chart',
      xField: 'region',
      yField: 'revenue',
      colorField: 'region',
      specJson: JSON.stringify({
        chart_spec: {
          chartType: 'Donut Chart',
          encodings: { x: { field: 'region' }, y: { field: 'revenue' }, color: { field: 'region' } },
        },
      }),
    }));

    const generated = await generateFlintOptionsFromAi({
      providerUid: 'flint-ai-demo',
      frames: [frame],
      userPrompt: 'render a donut chart',
      client: { generate },
    });

    expect(generated.chartType).toBe('Pie Chart');
    expect(generated.specJson).toBe('');
  });

  it('rejects a model suggestion that references a missing query field', async () => {
    const generate = jest.fn(async () => ({ chartType: 'Bar Chart', xField: 'country', yField: 'revenue' }));

    await expect(
      generateFlintOptionsFromAi({
        providerUid: 'provider-a',
        frames: [frame],
        userPrompt: 'bar',
        client: { generate },
      })
    ).rejects.toThrow(/unknown query field "country"/);
  });

  it('requires data before it calls the secure proxy', async () => {
    await expect(
      generateFlintOptionsFromAi({ providerUid: 'provider-a', frames: [], userPrompt: 'hi' })
    ).rejects.toThrow(/No query data/);
  });
});

describe('applyGeneratedOptions', () => {
  it('merges generated fields into panel options', () => {
    const next = applyGeneratedOptions(
      {
        renderBackend: 'echarts',
        chartType: 'auto',
        waterfallTotals: 'auto',
        xField: '',
        yField: '',
        colorField: '',
        specJson: '',
        ai: { lastPrompt: '' },
      },
      {
        chartType: 'Line Chart',
        xField: 'Time',
        yField: 'Value',
        colorField: 'series',
        specJson: '',
        rationale: 'ok',
      }
    );

    expect(next.chartType).toBe('Line Chart');
    expect(next.xField).toBe('Time');
  });
});
