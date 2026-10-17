import Ajv2020 from 'ajv/dist/2020';
import schema from '../../docs/schemas/flint-panel-options.schema.json';
import { validateSourceShape } from './sourceValidation';
import { createManualChartDraft } from './manualChartDraft';
import { toChartState } from './chartState';

const ajv = new Ajv2020({ strict: false });
ajv.addSchema(schema);
const validate = ajv.compile({ $ref: schema.$id + '#/$defs/flintInput' });
const spec = { chartType: 'Bar Chart', encodings: { x: 'category', y: 'value' } };

it.each([
  { chart_spec: { ...spec, extra: true } },
  { chart_spec: { ...spec, title: false } },
  { chart_spec: { ...spec, baseSize: { width: -1, height: 100 } } },
  { chart_spec: spec, options: { addTooltips: 'false' } },
  { chart_spec: spec, options: { maxColorValues: 1.5 } },
  { chart_spec: spec, options: { unknown: true } },
  { chart_spec: { ...spec, encodings: { x: 'category', y: ['value', 'value'] } } },
  { chart_spec: { ...spec, encodings: { x: 'category', y: { field: 'value', aggregate: 'median' } } } },
])('runtime and published JSON schema both reject malformed source: %j', (input) => {
  expect(() => validateSourceShape(input)).toThrow('Invalid Flint spec JSON');
  expect(validate(input)).toBe(false);
});

it('accepts valid advanced settings in both runtime and published schema', () => {
  const input = {
    chart_spec: {
      ...spec,
      baseSize: { width: 600, height: 400 },
      encodings: { x: 'category', y: ['value', 'profit'] },
    },
    semantic_types: { value: { semanticType: 'Amount', unit: 'USD', intrinsicDomain: [0, 100] } },
    options: {
      addTooltips: false,
      stepPadding: 0.2,
      continuousMarkCrossSection: { x: 0, y: 100, seriesCountAxis: 'auto' },
    },
  };
  expect(() => validateSourceShape(input)).not.toThrow();
  expect(validate(input) ? [] : validate.errors).toEqual([]);
});

it('rejects malformed manual patches before creating a replacement draft', () => {
  const original = toChartState({ chartType: 'Bar Chart', xField: 'category', yField: 'value' });
  const before = JSON.stringify(original);
  expect(() =>
    createManualChartDraft({ options: original, patch: { channelFields: { y: ['value', 'value'] } } })
  ).toThrow('duplicates');
  expect(JSON.stringify(original)).toBe(before);
});
