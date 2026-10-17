import React, { useState } from 'react';
import { css } from '@emotion/css';
import { FieldType, type GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Combobox, Input, MultiCombobox, useStyles2 } from '@grafana/ui';

import { buildChartAssemblyInput } from '../flint/assemble';
import {
  allowedChartTypesForBackend,
  chartCatalogForBackend,
  type FlintChartPropertyCatalogEntry,
} from '../flint/chartTypes';
import type { FlintChartState } from '../flint/chartState';
import type { FlintTable } from '../flint/dataFrames';
import { encodingFields, MULTI_MEASURE_CHARTS, type ManualChartSettingsPatch } from '../flint/manualChartDraft';
import { FLINT_THEME_PRESETS, supportsThemePresets } from '../flint/themes';
import { RENDER_BACKENDS } from '../flint/backends';

const AUTO = '__flint_auto_field__';
const DEFAULT_THEME = '__flint_default_theme__';
const getStyles = (theme: GrafanaTheme2) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: ${theme.spacing(2)};
  `,
  field: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
  `,
  label: css`
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  help: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  section: css`
    margin-top: ${theme.spacing(2)};
  `,
  additionalMappings: css`
    /* Grafana's details styles reset descendants to content-box. Its form controls need border-box. */
    &,
    & * {
      box-sizing: border-box;
    }
  `,
  number: css`
    display: flex;
    gap: ${theme.spacing(1)};
  `,
});

function channelLabel(chartType: string, channel: string): string {
  if (chartType === 'Pie Chart' && ['size', 'color'].includes(channel)) {
    return channel === 'size' ? 'Value field' : 'Category field';
  }
  if (chartType === 'Heatmap' && channel === 'color') {
    return 'Color value field';
  }
  return (
    (
      {
        x: 'X field',
        y: 'Y field',
        color: 'Color field',
        group: 'Group field',
        size: 'Size field',
        opacity: 'Opacity field',
        row: 'Row facet',
        column: 'Column facet',
        detail: 'Detail field',
        strokeDash: 'Line style field',
      } as Record<string, string>
    )[channel] ?? `${channel} field`
  );
}

function NumberProperty({
  definition,
  value,
  disabled,
  onChange,
}: {
  definition: FlintChartPropertyCatalogEntry;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const styles = useStyles2(getStyles);
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();
  const commit = () => {
    if (text === undefined) {
      return;
    }
    if (!text.trim()) {
      onChange(undefined);
      setText(undefined);
      setError(undefined);
      return;
    }
    const number = Number(text);
    if (!Number.isFinite(number) || number < (definition.min ?? -Infinity) || number > (definition.max ?? Infinity)) {
      setError(`Enter a number between ${definition.min} and ${definition.max}.`);
      return;
    }
    onChange(number);
    setText(undefined);
    setError(undefined);
  };
  return (
    <>
      <div className={styles.number}>
        <Input
          id={`flint-property-${definition.key}`}
          aria-label={definition.label ?? definition.key}
          type="number"
          min={definition.min}
          max={definition.max}
          step={definition.step ?? 'any'}
          disabled={disabled}
          value={text ?? (typeof value === 'number' ? String(value) : '')}
          placeholder={`Default${definition.defaultValue === undefined ? '' : `: ${definition.defaultValue}`}`}
          onChange={(event) => setText(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit();
            }
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || (value === undefined && text === undefined)}
          aria-label={`Reset ${definition.label ?? definition.key}`}
          onClick={() => {
            setText(undefined);
            setError(undefined);
            onChange(undefined);
          }}
        >
          Reset
        </Button>
      </div>
      {error && <span role="alert">{error}</span>}
    </>
  );
}

export function ChartSettings({
  state,
  table,
  disabled,
  onChange,
}: {
  state: FlintChartState;
  table: FlintTable;
  disabled: boolean;
  onChange: (patch: ManualChartSettingsPatch) => void;
}) {
  const styles = useStyles2(getStyles);
  const spec = state.flintInput.chart_spec;
  const themesSupported = supportsThemePresets(state.renderBackend);
  const selectedTheme = FLINT_THEME_PRESETS.find((preset) => preset.id === state.flintInput.theme_spec);
  let runtime: ReturnType<typeof buildChartAssemblyInput> | undefined;
  try {
    runtime = buildChartAssemblyInput(table, state, { width: 800, height: 450 });
  } catch {
    /* Source errors remain visible in the workbench. */
  }
  const chartType = runtime?.chart_spec.chartType ?? spec.chartType;
  const catalog = chartCatalogForBackend(state.renderBackend).find((entry) => entry.chartType === chartType);
  const fields = table.fields.map((field) => ({
    label: field.name,
    description: String(field.type),
    value: field.name,
  }));
  const missing = Object.values(spec.encodings ?? {})
    .flatMap(encodingFields)
    .filter((field) => !table.fields.some((entry) => entry.name === field));
  const required =
    catalog?.requiredChannels.filter(
      (channel) =>
        !encodingFields(runtime?.chart_spec.encodings?.[channel]).length &&
        !(['group', 'color'].includes(channel) && (encodingFields(runtime?.chart_spec.encodings?.y).length ?? 0) > 1)
    ) ?? [];
  const renderChannel = (channel: string) => {
    const selected = encodingFields(spec.encodings?.[channel]);
    const inferred = encodingFields(runtime?.chart_spec.encodings?.[channel]);
    const multiple =
      (channel === 'x' || channel === 'y') &&
      MULTI_MEASURE_CHARTS.includes(chartType) &&
      (channel === 'y' || selected.length > 1);
    const label = channelLabel(chartType, channel);
    const id = `flint-${channel}-field`;
    const automatic = !selected.length && (state.bindingMode === 'auto' || spec.chartType === 'auto');
    const measures = encodingFields(runtime?.chart_spec.encodings?.y);
    const fromMeasures = ['group', 'color'].includes(channel) && !selected.length && measures.length > 1;
    return (
      <div className={styles.field} key={channel}>
        <label className={styles.label} id={`${id}-label`} htmlFor={id}>
          {label}
        </label>
        {multiple ? (
          <MultiCombobox
            id={id}
            aria-labelledby={`${id}-label`}
            disabled={disabled}
            isClearable
            placeholder={automatic ? `Auto${inferred.length ? `: ${inferred.join(', ')}` : ''}` : 'Select value fields'}
            options={fields.filter(
              (field) =>
                table.fields.find((entry) => entry.name === field.value)?.type === FieldType.number ||
                selected.includes(field.value)
            )}
            value={selected}
            onChange={(options) => onChange({ channelFields: { [channel]: options.map((option) => option.value) } })}
          />
        ) : (
          <Combobox
            id={id}
            aria-labelledby={`${id}-label`}
            disabled={disabled || fromMeasures}
            options={[{ label: `Auto${inferred.length ? `: ${inferred.join(', ')}` : ''}`, value: AUTO }, ...fields]}
            value={
              selected.length === 1
                ? selected[0]
                : selected.length > 1
                  ? { value: '__custom__', label: `Custom: ${selected.join(', ')}` }
                  : AUTO
            }
            onChange={(option) =>
              onChange({ channelFields: { [channel]: option.value === AUTO ? [] : [option.value] } })
            }
          />
        )}
        <span className={styles.help}>
          {multiple ? 'Select one or more values. Clear to use Auto. ' : ''}
          {fromMeasures
            ? `Series from value fields: ${measures.join(', ')}`
            : automatic
              ? `Auto: ${inferred.join(', ') || (catalog?.requiredChannels.includes(channel) ? 'No suitable field' : 'Not used')}`
              : selected.length
                ? selected.join(', ')
                : 'Not bound'}
          {catalog?.requiredChannels.includes(channel) ? ' · Required' : ''}
        </span>
      </div>
    );
  };
  const primaryChannels =
    catalog?.channels.filter((channel) => ['x', 'y', 'group', 'color', 'size'].includes(channel)) ?? [];
  const extraChannels = catalog?.channels.filter((channel) => !primaryChannels.includes(channel)) ?? [];
  return (
    <>
      {missing.length > 0 && (
        <Alert title="Query fields changed" severity="warning">
          Select replacements for: {[...new Set(missing)].join(', ')}.
        </Alert>
      )}
      {required.length > 0 && (
        <Alert title="Required fields" severity="warning">
          Select fields for: {required.map((channel) => channelLabel(chartType, channel)).join(', ')}.
        </Alert>
      )}
      <div className={styles.grid}>
        <div className={styles.field}>
          <label id="flint-chart-type-label" htmlFor="flint-chart-type" className={styles.label}>
            Chart type
          </label>
          <Combobox
            id="flint-chart-type"
            aria-labelledby="flint-chart-type-label"
            disabled={disabled}
            options={allowedChartTypesForBackend(state.renderBackend).map((value) => ({
              value,
              label: value === 'auto' ? `Auto: ${chartType}` : value,
            }))}
            value={spec.chartType}
            onChange={(option) => onChange({ chartType: option.value })}
          />
        </div>
        {primaryChannels.map(renderChannel)}
      </div>
      {extraChannels.length > 0 && (
        <details className={`${styles.section} ${styles.additionalMappings}`}>
          <summary>Additional field mappings</summary>
          <div className={styles.grid}>{extraChannels.map(renderChannel)}</div>
        </details>
      )}
      <div className={styles.section}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="flint-theme-preset">
            Theme preset
          </label>
          <Combobox
            id="flint-theme-preset"
            aria-label="Theme preset"
            disabled={disabled || !themesSupported}
            options={[
              { label: 'Default (Flint)', value: DEFAULT_THEME },
              ...FLINT_THEME_PRESETS.map((preset) => ({
                label: preset.label,
                value: preset.id,
                description: preset.description,
              })),
            ]}
            value={selectedTheme?.id ?? DEFAULT_THEME}
            onChange={(option) => onChange({ themePreset: option.value === DEFAULT_THEME ? null : option.value })}
          />
          <span className={styles.help} role={themesSupported ? undefined : 'status'}>
            {themesSupported
              ? (selectedTheme?.description ?? 'Use Flint’s default presentation.')
              : `${RENDER_BACKENDS.find((backend) => backend.value === state.renderBackend)?.label ?? state.renderBackend} does not support theme presets. Theme presets are supported only by Vega-Lite.${selectedTheme ? ' The selected theme is retained and will apply when you switch back to Vega-Lite.' : ''}`}
          </span>
        </div>
      </div>
      <div className={styles.section}>
        <div className={styles.label}>Chart options</div>
        <div className={styles.grid}>
          {(catalog?.properties ?? []).map((definition) => {
            const value = spec.chartProperties?.[definition.key];
            const label = definition.key === 'totals' ? 'Waterfall totals' : (definition.label ?? definition.key);
            const choices =
              definition.type === 'binary'
                ? [
                    { label: 'On', value: true },
                    { label: 'Off', value: false },
                  ]
                : (definition.options ?? []).map((option, index) => ({
                    label: definition.optionLabels?.[index] ?? String(option),
                    value: option,
                  }));
            return (
              <div className={styles.field} key={definition.key}>
                <label className={styles.label} htmlFor={`flint-property-${definition.key}`}>
                  {label}
                </label>
                {definition.type === 'continuous' ? (
                  <NumberProperty
                    key={`${chartType}-${definition.key}-${String(value)}`}
                    definition={definition}
                    value={value}
                    disabled={disabled}
                    onChange={(next) => onChange({ chartProperties: { [definition.key]: next } })}
                  />
                ) : (
                  <Combobox
                    id={`flint-property-${definition.key}`}
                    aria-label={label}
                    disabled={disabled}
                    options={[
                      {
                        label: `Default${definition.defaultValue === undefined ? '' : `: ${definition.defaultValue}`}`,
                        value: 'default',
                      },
                      ...choices.map((choice, index) => ({ label: choice.label, value: String(index) })),
                    ]}
                    value={
                      value === undefined
                        ? 'default'
                        : String(choices.findIndex((choice) => Object.is(choice.value, value)))
                    }
                    onChange={(option) =>
                      onChange({
                        chartProperties: {
                          [definition.key]:
                            option.value === 'default' ? undefined : choices[Number(option.value)].value,
                        },
                      })
                    }
                  />
                )}
              </div>
            );
          })}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="flint-tooltips">
              Tooltip
            </label>
            <Combobox
              id="flint-tooltips"
              aria-label="Tooltip"
              disabled={disabled}
              options={[
                { label: 'On', value: 'on' },
                { label: 'Off', value: 'off' },
              ]}
              value={state.flintInput.options?.addTooltips === false ? 'off' : 'on'}
              onChange={(option) => onChange({ addTooltips: option.value === 'on' })}
            />
          </div>
        </div>
      </div>
    </>
  );
}
