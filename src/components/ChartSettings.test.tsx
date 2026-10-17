import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FieldType } from '@grafana/data';
import { ChartSettings } from './ChartSettings';
import { toChartState } from '../flint/chartState';
import type { FlintTable } from '../flint/dataFrames';
import { createManualChartDraft } from '../flint/manualChartDraft';

// jsdom has no canvas implementation; Grafana uses it only to size option text.
beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({ measureText: (text: string) => ({ width: text.length * 8 }) }),
  });
});

const table: FlintTable = {
  fields: [
    { name: 'quarter', type: FieldType.string },
    { name: 'region', type: FieldType.string },
    { name: 'revenue', type: FieldType.number },
    { name: 'profit', type: FieldType.number },
  ],
  values: [{ quarter: 'Q1', region: 'North', revenue: 120, profit: 30 }],
};

function Settings({ chartType = 'auto' }: { chartType?: string }) {
  const [state, setState] = useState(toChartState({ chartType }));
  return (
    <>
      <ChartSettings
        state={state}
        table={table}
        disabled={false}
        onChange={(patch) => setState(toChartState(createManualChartDraft({ options: state, patch })))}
      />
      <output data-testid="source">{JSON.stringify(state.flintInput)}</output>
    </>
  );
}

it('shows inferred measure fields and offers only channels supported by the chart', () => {
  const { unmount } = render(<Settings />);
  expect(screen.getAllByText(/Auto: revenue, profit/).length).toBeGreaterThan(0);
  expect(screen.queryByRole('combobox', { name: 'Group field' })).not.toBeInTheDocument();
  unmount();
  render(<Settings chartType="Pie Chart" />);
  expect(screen.getByRole('combobox', { name: 'Value field' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Category field' })).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'X field' })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Group field' })).not.toBeInTheDocument();
});

it('validates numeric options and resets the override to the compiler default', () => {
  render(<Settings chartType="Pie Chart" />);
  const input = screen.getByRole('spinbutton', { name: /Donut/i });
  fireEvent.change(input, { target: { value: '100' } });
  fireEvent.blur(input);
  expect(screen.getByRole('alert')).toHaveTextContent('between 0 and 60');
  expect(JSON.parse(screen.getByTestId('source').textContent!).chart_spec.chartProperties).toBeUndefined();
  fireEvent.change(input, { target: { value: '40' } });
  fireEvent.blur(input);
  expect(JSON.parse(screen.getByTestId('source').textContent!).chart_spec.chartProperties.innerRadius).toBe(40);
  fireEvent.click(screen.getByRole('button', { name: /Reset.*Donut/i }));
  expect(JSON.parse(screen.getByTestId('source').textContent!).chart_spec.chartProperties).toEqual({});
});

it.each(['echarts', 'chartjs', 'plotly'] as const)(
  'disables theme selection and explains lack of support with %s',
  (backend) => {
    render(
      <ChartSettings
        state={toChartState({
          renderBackend: backend,
          flintInput: {
            theme_spec: 'swiss',
            chart_spec: { chartType: 'Bar Chart', encodings: { x: 'quarter', y: 'revenue' } },
          },
        })}
        table={table}
        disabled={false}
        onChange={jest.fn()}
      />
    );
    expect(screen.getByRole('combobox', { name: 'Theme preset' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('supported only by Vega-Lite');
    expect(screen.getByRole('status')).toHaveTextContent('selected theme is retained');
  }
);

it('enables the theme selector for Vega-Lite and displays the selected preset', () => {
  render(
    <ChartSettings
      state={toChartState({
        renderBackend: 'vegalite',
        flintInput: {
          theme_spec: 'economist',
          chart_spec: { chartType: 'Bar Chart', encodings: { x: 'quarter', y: 'revenue' } },
        },
      })}
      table={table}
      disabled={false}
      onChange={jest.fn()}
    />
  );
  expect(screen.getByRole('combobox', { name: 'Theme preset' })).toBeEnabled();
  expect(screen.getByRole('combobox', { name: 'Theme preset' })).toHaveValue('The Economist');
});
