import { FieldType, toDataFrame } from '@grafana/data';

import { applyGeneratedOptions, generateFlintOptionsFromAi } from './generateOptions';

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
    expect(generated.rationale).toContain('Ignored an incompatible specJson');
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
