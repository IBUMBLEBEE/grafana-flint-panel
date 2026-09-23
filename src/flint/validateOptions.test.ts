import { FieldType, toDataFrame } from '@grafana/data';

import { defaultFlintOptions } from '../types';
import { dataFramesToFlintTable } from './dataFrames';
import { validateFlintOptions, validatePendingViz } from './validateOptions';

const table = dataFramesToFlintTable([
  toDataFrame({
    fields: [
      { name: 'region', type: FieldType.string, values: ['North'] },
      { name: 'revenue', type: FieldType.number, values: [120] },
    ],
  }),
]);

describe('validatePendingViz', () => {
  const valid = {
    chartType: 'Bar Chart',
    xField: 'region',
    yField: 'revenue',
    colorField: '',
    specJson: '',
  };

  it('accepts supported chart types and query fields', () => {
    expect(() => validatePendingViz(valid, ['region', 'revenue'])).not.toThrow();
  });

  it('rejects fields that are not part of the current query', () => {
    expect(() => validatePendingViz({ ...valid, yField: 'profit' }, ['region', 'revenue'])).toThrow(
      /unknown query field "profit"/
    );
  });

  it('rejects embedded rows in a generated Flint spec', () => {
    expect(() =>
      validatePendingViz(
        {
          ...valid,
          specJson: JSON.stringify({
            chart_spec: { chartType: 'Bar Chart', encodings: { x: { field: 'region' } } },
            data: { values: [{ region: 'North', revenue: 120 }] },
          }),
        },
        ['region', 'revenue']
      )
    ).toThrow(/must not contain data/);
  });

  it('allows a real query field named data without treating its semantic annotation as embedded rows', () => {
    expect(() =>
      validatePendingViz(
        {
          ...valid,
          xField: 'data',
          specJson: JSON.stringify({
            semantic_types: { data: 'Category', revenue: 'Amount' },
            chart_spec: {
              chartType: 'Bar Chart',
              encodings: { x: { field: 'data' }, y: { field: 'revenue' } },
            },
          }),
        },
        ['data', 'revenue']
      )
    ).not.toThrow();
  });

  it('rejects spec encodings that reference missing query fields', () => {
    expect(() =>
      validatePendingViz(
        {
          ...valid,
          specJson: JSON.stringify({
            chartType: 'Bar Chart',
            encodings: { x: { field: 'country' }, y: { field: 'revenue' } },
          }),
        },
        ['region', 'revenue']
      )
    ).toThrow(/unknown query field "country"/);
  });

  it('rejects unknown fields inside static-series encoding arrays', () => {
    expect(() =>
      validatePendingViz(
        {
          ...valid,
          specJson: JSON.stringify({
            chartType: 'Line Chart',
            encodings: { x: { field: 'region' }, y: ['revenue', 'profit'] },
          }),
        },
        ['region', 'revenue']
      )
    ).toThrow(/unknown query field "profit"/);
  });

  it('validates chartProperties against the selected backend runtime catalog', () => {
    expect(() =>
      validatePendingViz(
        {
          ...valid,
          specJson: JSON.stringify({
            chartType: 'Bar Chart',
            encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
            chartProperties: { cornerRadius: 99 },
          }),
        },
        ['region', 'revenue']
      )
    ).toThrow(/cornerRadius.*between 0 and 15/);
  });

  it('rejects encoding channels that the selected Flint backend chart does not support', () => {
    expect(() =>
      validatePendingViz(
        {
          ...valid,
          chartType: 'Pie Chart',
          specJson: JSON.stringify({
            chartType: 'Pie Chart',
            encodings: {
              x: { field: 'region' },
              size: { field: 'revenue' },
              color: { field: 'region' },
            },
          }),
        },
        ['region', 'revenue']
      )
    ).toThrow(/does not support encoding channel "x"/);
  });

  it('requires Pie Chart size and color channels in an advanced spec', () => {
    expect(() =>
      validatePendingViz(
        {
          ...valid,
          chartType: 'Pie Chart',
          specJson: JSON.stringify({
            chartType: 'Pie Chart',
            encodings: { color: { field: 'region' } },
          }),
        },
        ['region', 'revenue']
      )
    ).toThrow(/requires size encodings/);
  });

  it('rejects persisted Framework overrides that target runtime query data', () => {
    expect(() =>
      validatePendingViz(
        {
          ...valid,
          frameworkOverrides: {
            chartjs: {
              version: 1,
              backend: 'chartjs',
              compilerVersion: '0.5.1',
              sourceFingerprint: 'source-a',
              patch: [{ op: 'replace', path: '/data/datasets/0/data', value: [9999] }],
            },
          },
        },
        ['region', 'revenue']
      )
    ).toThrow(/query data/);
  });

  it('rejects persisted Framework overrides that remove runtime series structure', () => {
    expect(() =>
      validatePendingViz(
        {
          ...valid,
          frameworkOverrides: {
            echarts: {
              version: 1,
              backend: 'echarts',
              compilerVersion: '0.5.1',
              sourceFingerprint: 'source-a',
              patch: [{ op: 'remove', path: '/series' }],
            },
          },
        },
        ['region', 'revenue']
      )
    ).toThrow(/runtime-owned structure/);
  });
});

describe('validateFlintOptions', () => {
  it('also protects options written directly by an MCP dashboard patch', () => {
    expect(() =>
      validateFlintOptions(
        {
          ...defaultFlintOptions,
          specJson: JSON.stringify({
            chartType: 'Bar Chart',
            encodings: { x: { field: 'missing' } },
          }),
        },
        table
      )
    ).toThrow(/unknown query field "missing"/);
  });

  it('rejects an unsupported Waterfall totals mode from a dashboard patch', () => {
    expect(() =>
      validateFlintOptions(
        {
          ...defaultFlintOptions,
          chartType: 'Waterfall Chart',
          xField: 'region',
          yField: 'revenue',
          waterfallTotals: 'middle' as never,
        },
        table
      )
    ).toThrow(/Unsupported Waterfall totals mode "middle"/);
  });
});
