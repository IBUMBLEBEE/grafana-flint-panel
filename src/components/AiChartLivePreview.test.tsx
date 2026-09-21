import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { toDataFrame } from '@grafana/data';

import { mountBackendChart } from '../flint/renderBackend';
import { defaultFlintOptions } from '../types';
import { AiChartLivePreview } from './AiChartLivePreview';

jest.mock('../flint/renderBackend', () => ({
  mountBackendChart: jest.fn(),
}));

const mountBackendChartMock = jest.mocked(mountBackendChart);

describe('AiChartLivePreview', () => {
  beforeEach(() => {
    mountBackendChartMock.mockReset();
  });

  it('uses a safe render size while its tab panel is hidden', async () => {
    mountBackendChartMock.mockImplementation(async ({ size }) => {
      if (size.width <= 1 || size.height <= 1) {
        throw new TypeError("Cannot read properties of undefined (reading '_redrawFromAutoMarginCount')");
      }
      return {
        dispose: jest.fn(),
        resize: jest.fn(),
        update: jest.fn(),
      };
    });
    const onStatusChange = jest.fn();
    const frame = toDataFrame({
      fields: [
        { name: 'Label', values: ['A', 'B'] },
        { name: 'Value', values: [1, 2] },
      ],
    });

    render(
      <div hidden>
        <AiChartLivePreview
          frames={[frame]}
          options={{ ...defaultFlintOptions, renderBackend: 'plotly', chartType: 'Bar Chart' }}
          draft={{
            renderBackend: 'chartjs',
            chartType: 'Bar Chart',
            xField: 'Label',
            yField: 'Value',
            colorField: '',
            specJson: '',
          }}
          onStatusChange={onStatusChange}
        />
      </div>
    );

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith('ready'));
    expect(mountBackendChartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: 'chartjs',
        size: expect.objectContaining({ width: 800, height: 450 }),
      })
    );
    expect(onStatusChange).not.toHaveBeenCalledWith(
      'error',
      "Cannot read properties of undefined (reading '_redrawFromAutoMarginCount')"
    );
  });

  it('does not remount the chart when only the AI provider changes', async () => {
    const mounted = {
      dispose: jest.fn(),
      resize: jest.fn(),
      update: jest.fn(),
    };
    mountBackendChartMock.mockResolvedValue(mounted);
    const frame = toDataFrame({
      fields: [
        { name: 'Label', values: ['A', 'B'] },
        { name: 'Value', values: [1, 2] },
      ],
    });
    const { rerender } = render(
      <AiChartLivePreview
        frames={[frame]}
        options={{ ...defaultFlintOptions, ai: { lastPrompt: '', providerUid: 'provider-a' } }}
      />
    );
    await waitFor(() => expect(mountBackendChartMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender(
        <AiChartLivePreview
          frames={[frame]}
          options={{ ...defaultFlintOptions, ai: { lastPrompt: '', providerUid: 'provider-b' } }}
        />
      );
      await Promise.resolve();
    });

    expect(mountBackendChartMock).toHaveBeenCalledTimes(1);
    expect(mounted.dispose).not.toHaveBeenCalled();
  });
});
