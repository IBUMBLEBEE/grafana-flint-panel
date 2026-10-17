import { FieldType, toDataFrame } from '@grafana/data';

import { applyGeneratedOptions, generateFlintOptionsFromAi } from './generateOptions';
import type { GenerateChartRequest, RepairChartRequest } from './providerClient';
import { toChartState } from '../flint/chartState';
import { migrateFlintOptions } from '../migrations';

describe('generateFlintOptionsFromAi', () => {
  const frame = toDataFrame({
    fields: [
      { name: 'region', type: FieldType.string, values: ['North'] },
      { name: 'revenue', type: FieldType.number, values: [120] },
    ],
  });
  it('keeps structured-only source canonical from generation through Apply', async () => {
    const chartInput = {
      semantic_types: { region: 'Category', revenue: 'Amount' },
      options: { addTooltips: true },
      chart_spec: {
        chartType: 'Bar Chart',
        title: 'Revenue by region',
        encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
        chartProperties: { cornerRadius: 4 },
      },
    };
    const generated = await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [frame],
      userPrompt: 'bar with a title',
      client: { generate: async () => ({ chartInput, rationale: 'Compare regions.' }) },
    });
    expect(generated).toMatchObject({ stateVersion: 1, bindingMode: 'explicit', flintInput: chartInput });
    expect(generated).not.toHaveProperty('specJson');
    const applied = applyGeneratedOptions({ ai: { lastPrompt: '' } }, generated);
    expect(applied.flintInput).toEqual(chartInput);
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

    expect(generated.flintInput.chart_spec.chartType).toBe('Bar Chart');
    expect(generated.flintInput.chart_spec.encodings?.x).toEqual({ field: 'region' });
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
  it('refines presentation while preserving the current source and binding policy', async () => {
    const currentChartState = toChartState({
      renderBackend: 'plotly',
      bindingMode: 'auto',
      flintInput: {
        semantic_types: { region: 'Category', revenue: 'Amount' },
        options: { addTooltips: true },
        chart_spec: {
          chartType: 'Bar Chart',
          title: 'Before',
          encodings: { x: 'region', y: 'revenue' },
          chartProperties: { cornerRadius: 4 },
        },
      },
    });
    const input = {
      ...currentChartState.flintInput,
      field_display_names: { revenue: 'Revenue (USD)' },
      chart_spec: { ...currentChartState.flintInput.chart_spec, title: 'After', subtitle: 'One region' },
    };
    let sent: GenerateChartRequest | undefined;
    const generated = await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [frame],
      userPrompt: 'Rename the headline',
      generationMode: 'refine',
      currentChartState,
      client: {
        generate: async (_uid, request) => {
          sent = request;
          return { chartInput: input };
        },
      },
    });
    expect(generated).toMatchObject({ renderBackend: 'plotly', bindingMode: 'auto', flintInput: input });
    expect(sent).toMatchObject({
      generationMode: 'refine',
      currentChartState,
      allowedPaths: ['/chart_spec/title', '/chart_spec/subtitle', '/field_display_names', '/seriesColors'],
    });
    expect(sent?.prompt).toContain('Rename the headline');
    expect(sent?.prompt).toContain('Only');
    expect(sent?.prompt).toContain('Before');
    expect(generated.baseFingerprint).toEqual(expect.any(String));
  });

  it('normalizes common chartType aliases from models', async () => {
    const generate = jest.fn(async () => ({ chartType: 'bar', xField: 'region', yField: 'revenue' }));

    const generated = await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [frame],
      userPrompt: 'bar',
      client: { generate },
    });

    expect(generated.flintInput.chart_spec.chartType).toBe('Bar Chart');
  });
  it('rejects a refinement that changes field bindings rather than dropping semantics into a scalar fallback', async () => {
    const currentChartState = toChartState({
      flintInput: {
        semantic_types: { region: 'Category', revenue: 'Amount' },
        chart_spec: { chartType: 'Bar Chart', encodings: { x: 'region', y: 'revenue' } },
      },
    });
    await expect(
      generateFlintOptionsFromAi({
        providerUid: 'provider-a',
        frames: [frame],
        userPrompt: 'Rename the title',
        generationMode: 'refine',
        currentChartState,
        client: {
          generate: async () => ({
            chartType: 'Bar Chart',
            xField: 'region',
            yField: 'revenue',
            chartInput: {
              ...currentChartState.flintInput,
              chart_spec: { ...currentChartState.flintInput.chart_spec, encodings: { x: 'region', y: 'region' } },
            },
          }),
        },
      })
    ).rejects.toThrow(/Refinement cannot change locked Flint source path/);
  });

  it('normalizes a Waterfall chart alias from models', async () => {
    const generate = jest.fn(async () => ({ chartType: 'waterfall', xField: 'region', yField: 'revenue' }));

    const generated = await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [frame],
      userPrompt: 'waterfall',
      client: { generate },
    });

    expect(generated.flintInput.chart_spec.chartType).toBe('Waterfall Chart');
  });
  it('keeps the same refinement locks during repair and rejects scalar-only repair', async () => {
    const currentChartState = toChartState({
      flintInput: {
        semantic_types: { revenue: 'Amount' },
        chart_spec: { chartType: 'Bar Chart', encodings: { x: 'region', y: 'revenue' } },
      },
    });
    let repairRequest: RepairChartRequest | undefined;
    await expect(
      generateFlintOptionsFromAi({
        providerUid: 'provider-a',
        frames: [frame],
        userPrompt: 'New title',
        generationMode: 'refine',
        currentChartState,
        client: {
          generate: async () => ({
            chartInput: {
              ...currentChartState.flintInput,
              chart_spec: { ...currentChartState.flintInput.chart_spec, chartType: 'Line Chart' },
            },
          }),
          repair: async (_uid, request) => {
            repairRequest = request;
            return { chartType: 'Bar Chart', xField: 'region', yField: 'revenue' };
          },
        },
      })
    ).rejects.toThrow(/repair failed: Refinement cannot change locked Flint source path.*semantic_types/);
    expect(repairRequest?.request).toMatchObject({
      currentChartState,
      allowedPaths: ['/chart_spec/title', '/chart_spec/subtitle', '/field_display_names', '/seriesColors'],
    });
  });
  it('rejects Apply of a refinement after the committed source changes', async () => {
    const currentChartState = toChartState({ chartType: 'Bar Chart', xField: 'region', yField: 'revenue' });
    const generated = await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [frame],
      userPrompt: 'Title',
      generationMode: 'refine',
      currentChartState,
      client: {
        generate: async () => ({
          chartInput: {
            ...currentChartState.flintInput,
            chart_spec: { ...currentChartState.flintInput.chart_spec, title: 'New title' },
          },
        }),
      },
    });
    const changed = { ...currentChartState, renderBackend: 'plotly' as const, ai: { lastPrompt: '' } };
    expect(() => applyGeneratedOptions(changed, generated)).toThrow(/stale.*chart source changed/);
    expect(applyGeneratedOptions({ ...currentChartState, ai: { lastPrompt: '' } }, generated)).not.toHaveProperty(
      'baseFingerprint'
    );
  });
  it('does not silently create Auto when structured-only input and repair are invalid', async () => {
    await expect(
      generateFlintOptionsFromAi({
        providerUid: 'provider-a',
        frames: [frame],
        userPrompt: 'bar',
        client: {
          generate: async () => ({ chartInput: { mark: 'bar' } }),
          repair: async () => ({ chartInput: { mark: 'bar' } }),
        },
      })
    ).rejects.toThrow(/failed validation and repair/);
  });
  it.each([null, 42])('rejects non-text refinement titles: %j', async (title) => {
    const currentChartState = toChartState({ chartType: 'Bar Chart', xField: 'region', yField: 'revenue' });
    await expect(
      generateFlintOptionsFromAi({
        providerUid: 'provider-a',
        frames: [frame],
        userPrompt: 'Title',
        generationMode: 'refine',
        currentChartState,
        client: {
          generate: async () => ({
            chartInput: {
              ...currentChartState.flintInput,
              chart_spec: { ...currentChartState.flintInput.chart_spec, title },
            },
          }),
        },
      })
    ).rejects.toThrow(/title must be a string/);
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
        flintInput: {
          chart_spec: { chartType: 'Bar Chart', encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
        },
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

    expect(generated.flintInput).toEqual({ chart_spec: JSON.parse(specJson) });
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

    expect(generated.flintInput).toEqual(chartInput);
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

      expect(generated.flintInput.chart_spec.chartType).toBe('Bar Chart');
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
    expect(generated.flintInput.chart_spec.chartProperties?.cornerRadius).toBe(5);
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

    expect(generated).not.toHaveProperty('specJson');
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

    expect(generated.flintInput.chart_spec.chartType).toBe('Pie Chart');
    expect(generated).not.toHaveProperty('specJson');
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

  it('keeps its refinement baseline immutable if the external provider mutates the request', async () => {
    const currentChartState = toChartState({ chartType: 'Bar Chart', xField: 'region', yField: 'revenue' });
    await expect(
      generateFlintOptionsFromAi({
        providerUid: 'provider-a',
        frames: [frame],
        userPrompt: 'Title',
        generationMode: 'refine',
        currentChartState,
        client: {
          generate: async (_uid, request) => {
            request.currentChartState!.flintInput.chart_spec.chartType = 'Line Chart';
            return { chartInput: request.currentChartState!.flintInput };
          },
        },
      })
    ).rejects.toThrow(/locked Flint source path.*chartType/);
  });
  it('requires data before it calls the secure proxy', async () => {
    await expect(
      generateFlintOptionsFromAi({ providerUid: 'provider-a', frames: [], userPrompt: 'hi' })
    ).rejects.toThrow(/No query data/);
  });
  it.each(['chartType', 'semantic_types', 'options', 'chartProperties', 'baseSize', 'sortOrder'])(
    'rejects unauthorized refinement additions or deletions: %s',
    async (change) => {
      const currentChartState = toChartState({
        flintInput: {
          semantic_types: { region: 'Category', revenue: 'Amount' },
          options: { addTooltips: true },
          chart_spec: {
            chartType: 'Bar Chart',
            title: 'Before',
            encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
            chartProperties: { cornerRadius: 4 },
          },
        },
      });
      const candidate = JSON.parse(JSON.stringify(currentChartState.flintInput));
      if (change === 'chartType') {
        candidate.chart_spec.chartType = 'Line Chart';
      }
      if (change === 'semantic_types') {
        delete candidate.semantic_types;
      }
      if (change === 'options') {
        delete candidate.options;
      }
      if (change === 'chartProperties') {
        candidate.chart_spec.chartProperties.cornerRadius = 5;
      }
      if (change === 'baseSize') {
        candidate.chart_spec.baseSize = { width: 400, height: 300 };
      }
      if (change === 'sortOrder') {
        candidate.chart_spec.encodings.x.sortOrder = 'descending';
      }
      await expect(
        generateFlintOptionsFromAi({
          providerUid: 'provider-a',
          frames: [frame],
          userPrompt: 'New title',
          generationMode: 'refine',
          currentChartState,
          client: { generate: async () => ({ chartInput: candidate }) },
        })
      ).rejects.toThrow(/Refinement cannot change locked Flint source path/);
    }
  );
  it('allows deleting only presentation text and retains the guard through draft reload and migration', async () => {
    const currentChartState = toChartState({
      flintInput: {
        semantic_types: { region: 'Category', revenue: 'Amount' },
        chart_spec: {
          chartType: 'Bar Chart',
          title: 'Before',
          subtitle: 'Old',
          encodings: { x: 'region', y: 'revenue' },
        },
      },
    });
    const generated = await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [frame],
      userPrompt: 'Remove title',
      generationMode: 'refine',
      currentChartState,
      client: {
        generate: async () => ({
          chartInput: {
            semantic_types: { region: 'Category', revenue: 'Amount' },
            chart_spec: { chartType: 'Bar Chart', encodings: { x: 'region', y: 'revenue' } },
          },
        }),
      },
    });
    const saved = JSON.parse(JSON.stringify({ ...currentChartState, ai: { lastPrompt: '', draft: generated } }));
    const migrated = migrateFlintOptions({ options: saved });
    expect(migrated.ai.draft?.baseFingerprint).toBe(generated.baseFingerprint);
    const restored = { ...generated, ...migrated.ai.draft };
    expect(() => applyGeneratedOptions({ ...migrated, renderBackend: 'plotly' }, restored)).toThrow(/stale/);
    expect(applyGeneratedOptions(migrated, restored).flintInput?.chart_spec).not.toHaveProperty('title');
  });
  it('allows real query fields named data in semantic and display-name maps', async () => {
    const dataFrame = toDataFrame({
      fields: [
        { name: 'data', type: FieldType.number, values: [120] },
        { name: 'region', type: FieldType.string, values: ['North'] },
      ],
    });
    const chartInput = {
      semantic_types: { data: 'Amount', region: 'Category' },
      field_display_names: { data: 'Revenue' },
      chart_spec: { chartType: 'Bar Chart', encodings: { x: 'region', y: 'data' } },
    };
    const generated = await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [dataFrame],
      userPrompt: 'Bar',
      client: { generate: async () => ({ chartInput }) },
    });
    expect(generated.flintInput).toEqual(chartInput);
  });
  it('rejects runtime data hidden under nested names that resemble field maps', async () => {
    await expect(
      generateFlintOptionsFromAi({
        providerUid: 'provider-a',
        frames: [frame],
        userPrompt: 'Bar',
        client: {
          generate: async () => ({
            chartInput: {
              chart_spec: { chartType: 'Bar Chart', encodings: { x: 'region', y: 'revenue' } },
              options: { field_display_names: { data: [{ secret: 'query-row' }] } },
            },
          }),
        },
      })
    ).rejects.toThrow(/must not contain data/);
  });
  it('keeps corrupt legacy recovery evidence local when creating a replacement', async () => {
    let outbound: GenerateChartRequest | undefined;
    await generateFlintOptionsFromAi({
      providerUid: 'provider-a',
      frames: [frame],
      userPrompt: 'Replace chart',
      currentChartState: toChartState({ specJson: '{"series":[{"data":["secret-row"]}]}' }),
      client: {
        generate: async (_uid, request) => {
          outbound = request;
          return { chartType: 'Bar Chart', xField: 'region', yField: 'revenue' };
        },
      },
    });
    expect(JSON.stringify(outbound)).not.toContain('secret-row');
    expect(outbound).not.toHaveProperty('currentChartState.recovery');
  });
  it('rejects a provider response that arrives after cancellation without repairing or falling back', async () => {
    const controller = new AbortController();
    const repair = jest.fn(async () => ({ chartType: 'Bar Chart', xField: 'region', yField: 'revenue' }));
    await expect(
      generateFlintOptionsFromAi({
        providerUid: 'provider-a',
        frames: [frame],
        userPrompt: 'bar',
        signal: controller.signal,
        client: {
          generate: async () => {
            controller.abort();
            return { chartType: 'Bar Chart', xField: 'region', yField: 'revenue' };
          },
          repair,
        },
      })
    ).rejects.toThrow(/Request cancelled/);
    expect(repair).not.toHaveBeenCalled();
  });
  it.each([{ data: null }, { chart_spec: { canvasSize: null } }])(
    'rejects raw runtime fields before normalization: %j',
    async (runtime) => {
      const chartInput = {
        chart_spec: { chartType: 'Bar Chart', encodings: { x: 'region', y: 'revenue' }, ...(runtime.chart_spec ?? {}) },
        ...('data' in runtime ? { data: runtime.data } : {}),
      };
      await expect(
        generateFlintOptionsFromAi({
          providerUid: 'provider-a',
          frames: [frame],
          userPrompt: 'bar',
          client: { generate: async () => ({ chartInput }) },
        })
      ).rejects.toThrow(/must not contain (data|canvasSize)/);
    }
  );
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
        ...toChartState({ chartType: 'Line Chart', xField: 'Time', yField: 'Value', colorField: 'series' }),
        rationale: 'ok',
      }
    );

    expect(next.flintInput?.chart_spec.chartType).toBe('Line Chart');
    expect(next.flintInput?.chart_spec.encodings?.x).toEqual({ field: 'Time' });
  });
});

it('preserves unmentioned manual settings when AI changes the chart structure', async () => {
  const frame = toDataFrame({
    fields: [
      { name: 'region', type: FieldType.string, values: ['North', 'South'] },
      { name: 'revenue', type: FieldType.number, values: [120, 90] },
    ],
  });
  const baseline = toChartState({
    flintInput: {
      semantic_types: { revenue: 'Amount', region: 'Category' },
      field_display_names: { revenue: 'Sales' },
      options: { addTooltips: false },
      chart_spec: {
        chartType: 'Bar Chart',
        title: 'Manual title',
        subtitle: 'Manual subtitle',
        encodings: { x: { field: 'region', sortOrder: 'descending' }, y: { field: 'revenue' } },
        chartProperties: { cornerRadius: 6 },
        baseSize: { width: 560, height: 400 },
      },
    },
  });
  const generated = await generateFlintOptionsFromAi({
    providerUid: 'provider-a',
    frames: [frame],
    userPrompt: 'Change to a line',
    currentChartState: baseline,
    client: {
      generate: async () => ({
        chartInput: {
          chart_spec: {
            chartType: 'Line Chart',
            encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
            chartProperties: { showPoints: true },
          },
        },
      }),
    },
  });
  expect(generated.flintInput).toMatchObject({
    semantic_types: baseline.flintInput.semantic_types,
    field_display_names: baseline.flintInput.field_display_names,
    options: { addTooltips: false },
    chart_spec: {
      chartType: 'Line Chart',
      title: 'Manual title',
      subtitle: 'Manual subtitle',
      encodings: { x: { field: 'region', sortOrder: 'descending' } },
      chartProperties: { showPoints: true },
      baseSize: { width: 560, height: 400 },
    },
  });
  expect(generated.flintInput.chart_spec.chartProperties).not.toHaveProperty('cornerRadius');
  expect(baseline.flintInput.chart_spec.chartType).toBe('Bar Chart');
});

it('keeps compatible chart options omitted by AI and accepts explicit option changes', async () => {
  const frame = toDataFrame({
    fields: [
      { name: 'region', values: ['North'] },
      { name: 'revenue', values: [120] },
    ],
  });
  const baseline = toChartState({
    flintInput: {
      options: { addTooltips: false },
      chart_spec: {
        chartType: 'Line Chart',
        encodings: { x: 'region', y: 'revenue' },
        chartProperties: { showPoints: true, interpolate: 'monotone' },
      },
    },
  });
  const generated = await generateFlintOptionsFromAi({
    providerUid: 'provider-a',
    frames: [frame],
    userPrompt: 'Use straight lines',
    currentChartState: baseline,
    client: {
      generate: async () => ({
        chartInput: {
          chart_spec: {
            chartType: 'Line Chart',
            encodings: { x: 'region', y: 'revenue' },
            chartProperties: { interpolate: 'linear' },
          },
        },
      }),
    },
  });
  expect(generated.flintInput.chart_spec.chartProperties).toEqual({ showPoints: true, interpolate: 'linear' });
  expect(generated.flintInput.options?.addTooltips).toBe(false);
});

it('preserves the selected official theme when AI changes unrelated settings', async () => {
  const frame = toDataFrame({
    fields: [
      { name: 'region', values: ['North'] },
      { name: 'revenue', values: [120] },
    ],
  });
  const baseline = toChartState({
    renderBackend: 'vegalite',
    flintInput: {
      theme_spec: 'economist',
      chart_spec: { chartType: 'Bar Chart', encodings: { x: 'region', y: 'revenue' } },
    },
  });
  const generated = await generateFlintOptionsFromAi({
    providerUid: 'provider-a',
    frames: [frame],
    userPrompt: 'Change to line',
    renderBackend: 'vegalite',
    currentChartState: baseline,
    client: {
      generate: async () => ({
        chartInput: { chart_spec: { chartType: 'Line Chart', encodings: { x: 'region', y: 'revenue' } } },
      }),
    },
  });
  expect(generated.flintInput.theme_spec).toBe('economist');
});
