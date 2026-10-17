import { listThemePresets } from 'flint-chart';
import { FieldType } from '@grafana/data';
import { FLINT_THEME_PRESETS } from './themes';
import { createManualChartDraft } from './manualChartDraft';
import { parseFlintInput, toChartState } from './chartState';
import { assemblePanelChart } from './assemble';
import { applyPendingViz } from './applyPendingViz';
import type { FlintTable } from './dataFrames';
import panelSchema from '../../docs/schemas/flint-panel-options.schema.json';

const table: FlintTable = {
  fields: [
    { name: 'category', type: FieldType.string },
    { name: 'value', type: FieldType.number },
  ],
  values: [
    { category: 'A', value: 12 },
    { category: 'B', value: 24 },
  ],
};
const size = { width: 640, height: 360 };
const input = { chart_spec: { chartType: 'Bar Chart', title: 'Results', encodings: { x: 'category', y: 'value' } } };

it('uses the installed official theme catalog', () => {
  expect(FLINT_THEME_PRESETS).toEqual(listThemePresets());
  expect(FLINT_THEME_PRESETS.length).toBeGreaterThan(0);
  expect(panelSchema.$defs.flintInput.properties.theme_spec.enum).toEqual(
    FLINT_THEME_PRESETS.map((preset) => preset.id)
  );
});

it.each(FLINT_THEME_PRESETS.map((preset) => preset.id))(
  'compiles preset %s with Vega-Lite and changes presentation',
  (id) => {
    const plain = toChartState({ renderBackend: 'vegalite', flintInput: input });
    const themed = createManualChartDraft({ options: plain, patch: { themePreset: id } });
    const result = assemblePanelChart(table, themed, size);
    expect(result.input.theme_spec).toBe(id);
    expect(result.payload).not.toEqual(assemblePanelChart(table, plain, size).payload);
    expect(plain.flintInput).toEqual(input);
    expect(themed.flintInput?.chart_spec).toEqual(input.chart_spec);
  }
);

it.each(['auto', 'explicit'] as const)(
  'saves and reloads a theme with %s bindings, and restores Default',
  (bindingMode) => {
    const options = toChartState({ renderBackend: 'vegalite', bindingMode, flintInput: input });
    const draft = createManualChartDraft({ options, patch: { themePreset: 'economist' } });
    const applied = applyPendingViz({ ...options, ai: { lastPrompt: '' } }, draft);
    const reloaded = toChartState(JSON.parse(JSON.stringify(applied)));
    expect(assemblePanelChart(table, reloaded, size).input.theme_spec).toBe('economist');
    expect(reloaded.bindingMode).toBe(bindingMode);
    const reset = createManualChartDraft({ options: reloaded, patch: { themePreset: null } });
    expect(reset.flintInput).not.toHaveProperty('theme_spec');
    expect(assemblePanelChart(table, reset, size).payload).toEqual(assemblePanelChart(table, options, size).payload);
  }
);

it.each(['echarts', 'chartjs', 'plotly'] as const)(
  'retains a preset but does not apply it to %s, and restores it on returning to Vega-Lite',
  (backend) => {
    const themed = toChartState({ renderBackend: 'vegalite', flintInput: { ...input, theme_spec: 'swiss' } });
    const switched = createManualChartDraft({ options: themed, patch: { renderBackend: backend } });
    expect(switched.flintInput?.theme_spec).toBe('swiss');
    const result = assemblePanelChart(table, switched, size);
    expect(result.input).not.toHaveProperty('theme_spec');
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('supported only by Vega-Lite')]));
    expect(JSON.stringify(result.payload)).toEqual(
      JSON.stringify(
        assemblePanelChart(table, toChartState({ renderBackend: backend, flintInput: input }), size).payload
      )
    );
    const back = createManualChartDraft({ options: switched, patch: { renderBackend: 'vegalite' } });
    expect(assemblePanelChart(table, back, size).input.theme_spec).toBe('swiss');
  }
);

it.each(['unknown-theme', '', null, 42, { extends: 'economist' }])('rejects unsupported theme source: %j', (theme) => {
  expect(() => parseFlintInput(JSON.stringify({ ...input, theme_spec: theme }))).toThrow(
    /official Flint theme preset ID/
  );
});

it('blocks theme edits on unsupported backends', () => {
  expect(() =>
    createManualChartDraft({ options: toChartState({ renderBackend: 'echarts' }), patch: { themePreset: 'swiss' } })
  ).toThrow(/supported only by Vega-Lite/);
});
