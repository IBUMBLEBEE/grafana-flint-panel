import Ajv from 'ajv';
import { writeFileSync } from 'node:fs';
import schema from '../../docs/contracts/ai-request-v1.schema.json';
import { chartCatalogForBackend, FLINT_SEMANTIC_TYPES } from '../flint/chartTypes';
import { toGenerateChartWireRequest, toRepairChartWireRequest } from './providerWire';

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);
const fixtures: Array<{ backend: string; generate: unknown; repair: unknown }> = [];

describe('serialized datasource request contract v1', () => {
  it.each(['echarts', 'vegalite', 'chartjs', 'plotly'] as const)(
    'accepts the complete %s catalog through generate and repair',
    (backend) => {
      const catalog = chartCatalogForBackend(backend);
      expect(catalog.length).toBeGreaterThan(0);
      const input = {
        prompt: 'Create a bar chart',
        generationMode: 'create' as const,
        allowedPaths: ['/seriesColors'],
        fields: [
          { name: 'quarter', type: 'string' },
          { name: 'revenue', type: 'number' },
        ],
        renderBackend: backend,
        chartCatalog: catalog,
        semanticTypes: FLINT_SEMANTIC_TYPES,
        sampleRows: [{ quarter: 'Q1', revenue: 123 }],
        frameSummary: [{ frameIndex: 0, refId: 'A', fields: ['quarter', 'revenue'] }],
        conversation: [{ role: 'user' as const, content: 'Create a bar chart' }],
        futureInternalField: 'must remain local',
      };
      const generate = JSON.parse(JSON.stringify(toGenerateChartWireRequest(input)));
      const repair = JSON.parse(
        JSON.stringify(
          toRepairChartWireRequest({
            request: input,
            candidate: { chartType: 'Bar Chart', xField: 'quarter', yField: 'revenue' },
            compileError: 'retry',
            attempt: 1,
          })
        )
      );
      for (const wire of [generate, repair]) {
        expect(validate(wire) ? [] : validate.errors).toEqual([]);
      }
      expect(generate).not.toHaveProperty('futureInternalField');
      expect(generate).not.toHaveProperty('generationMode');
      for (let i = 0; i < catalog.length; i++) {
        for (let j = 0; j < catalog[i].properties.length; j++) {
          const property = catalog[i].properties[j];
          const wire = generate.chartCatalog[i].properties[j];
          for (const key of ['key', 'type', 'min', 'max', 'options'] as const) {
            if (property[key] !== undefined) {
              expect(wire[key]).toEqual(JSON.parse(JSON.stringify(property[key])));
            }
          }
        }
      }
      fixtures.push({ backend, generate, repair });
      const bad = JSON.parse(JSON.stringify(generate));
      bad.chartCatalog[0].properties.push({ key: 'test', type: 'binary', label: 'UI-only' });
      expect(validate(bad)).toBe(false);
      expect(validate.errors?.some((error) => error.keyword === 'additionalProperties')).toBe(true);
    }
  );

  afterAll(() => {
    // The exact same serialized payloads are consumed by the datasource's real Go decoders.
    if (process.env.FLINT_AI_CONTRACT_FIXTURES) {
      writeFileSync(process.env.FLINT_AI_CONTRACT_FIXTURES, JSON.stringify(fixtures));
    }
  });
});
