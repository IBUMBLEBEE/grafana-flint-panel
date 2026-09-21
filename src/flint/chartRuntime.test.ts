import type { RenderBackend } from './backends';
import { createChartRuntime, type ChartMountAdapter, type ChartRenderRequest } from './chartRuntime';
import type { HostSize, MountedChart } from './renderBackend';

function mountedChart() {
  return {
    dispose: jest.fn(),
    resize: jest.fn<Promise<void>, [HostSize]>().mockResolvedValue(),
    update: jest.fn<Promise<void>, [Record<string, unknown>, HostSize]>().mockResolvedValue(),
  } satisfies MountedChart;
}

function request(overrides: Partial<ChartRenderRequest> = {}): ChartRenderRequest {
  return {
    backend: 'echarts',
    payload: { series: [] },
    payloadKey: 'payload-a',
    dataGeneration: 'data-a',
    size: { width: 800, height: 450, isDark: true },
    ...overrides,
  };
}

describe('chartRuntime', () => {
  it('mounts once and noops for an identical request', async () => {
    const mounted = mountedChart();
    const mount: jest.MockedFunction<ChartMountAdapter> = jest.fn().mockResolvedValue(mounted);
    const runtime = createChartRuntime(document.createElement('div'), mount);

    await expect(runtime.reconcile(request())).resolves.toBe('mount');
    await expect(runtime.reconcile(request({ payload: { another: 'object' } }))).resolves.toBe('noop');

    expect(mount).toHaveBeenCalledTimes(1);
    expect(mounted.update).not.toHaveBeenCalled();
    expect(mounted.resize).not.toHaveBeenCalled();
  });

  it('resizes without updating when only host size changes', async () => {
    const mounted = mountedChart();
    const mount: jest.MockedFunction<ChartMountAdapter> = jest.fn().mockResolvedValue(mounted);
    const runtime = createChartRuntime(document.createElement('div'), mount);
    await runtime.reconcile(request());

    const size = { width: 640, height: 360, isDark: true };
    await expect(runtime.reconcile(request({ size }))).resolves.toBe('resize');

    expect(mounted.resize).toHaveBeenCalledWith(size);
    expect(mounted.update).not.toHaveBeenCalled();
  });

  it.each([
    ['payload', { payload: { series: [1] }, payloadKey: 'payload-b' }],
    ['data', { dataGeneration: 'data-b' }],
  ] as const)('updates without remounting when %s changes', async (_label, overrides) => {
    const mounted = mountedChart();
    const mount: jest.MockedFunction<ChartMountAdapter> = jest.fn().mockResolvedValue(mounted);
    const runtime = createChartRuntime(document.createElement('div'), mount);
    await runtime.reconcile(request());

    const next = request(overrides);
    await expect(runtime.reconcile(next)).resolves.toBe('update');

    expect(mount).toHaveBeenCalledTimes(1);
    expect(mounted.update).toHaveBeenCalledWith(next.payload, next.size);
  });

  it('disposes and mounts exactly once when the backend changes', async () => {
    const first = mountedChart();
    const second = mountedChart();
    const mount: jest.MockedFunction<ChartMountAdapter> = jest
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const runtime = createChartRuntime(document.createElement('div'), mount);
    await runtime.reconcile(request());

    await expect(runtime.reconcile(request({ backend: 'plotly', payloadKey: 'plotly-a' }))).resolves.toBe('mount');

    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledTimes(2);
    expect(mount.mock.calls[1][0].backend).toBe('plotly');
  });

  it('shares an in-flight operation for the same request', async () => {
    let finishMount: ((chart: MountedChart) => void) | undefined;
    const mount: jest.MockedFunction<ChartMountAdapter> = jest.fn(
      (_args) => new Promise<MountedChart>((resolve) => (finishMount = resolve))
    );
    const runtime = createChartRuntime(document.createElement('div'), mount);

    const first = runtime.reconcile(request());
    const second = runtime.reconcile(request({ payload: { equivalent: true } }));
    await Promise.resolve();
    finishMount?.(mountedChart());

    await expect(first).resolves.toBe('mount');
    await expect(second).resolves.toBe('mount');
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('disposes a late mount and keeps only the newest request', async () => {
    const resolvers: Array<(chart: MountedChart) => void> = [];
    const mount: jest.MockedFunction<ChartMountAdapter> = jest.fn(
      (_args) => new Promise<MountedChart>((resolve) => resolvers.push(resolve))
    );
    const runtime = createChartRuntime(document.createElement('div'), mount);

    const firstChart = mountedChart();
    const secondChart = mountedChart();
    const first = runtime.reconcile(request());
    await Promise.resolve();
    const second = runtime.reconcile(
      request({ backend: 'vegalite', payloadKey: 'payload-b', dataGeneration: 'data-b' })
    );

    resolvers[0](firstChart);
    await first;
    expect(firstChart.dispose).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    resolvers[1](secondChart);
    await expect(second).resolves.toBe('mount');
    expect(secondChart.dispose).not.toHaveBeenCalled();
  });

  it('is idempotent when disposed and rejects future reconciliation', async () => {
    const mounted = mountedChart();
    const mount: jest.MockedFunction<ChartMountAdapter> = jest.fn().mockResolvedValue(mounted);
    const runtime = createChartRuntime(document.createElement('div'), mount);
    await runtime.reconcile(request());

    runtime.dispose();
    runtime.dispose();

    expect(mounted.dispose).toHaveBeenCalledTimes(1);
    await expect(runtime.reconcile(request())).rejects.toThrow('Chart runtime is disposed');
  });

  it('propagates update errors and can retry', async () => {
    const mounted = mountedChart();
    mounted.update.mockRejectedValueOnce(new Error('update failed'));
    const mount: jest.MockedFunction<ChartMountAdapter> = jest.fn().mockResolvedValue(mounted);
    const runtime = createChartRuntime(document.createElement('div'), mount);
    await runtime.reconcile(request());
    const changed = request({ payloadKey: 'payload-b' });

    await expect(runtime.reconcile(changed)).rejects.toThrow('update failed');
    await expect(runtime.reconcile(changed)).resolves.toBe('update');
  });

  it('forwards every supported backend through the mount adapter', async () => {
    const backends: RenderBackend[] = ['echarts', 'vegalite', 'plotly', 'chartjs'];

    for (const backend of backends) {
      const mount: jest.MockedFunction<ChartMountAdapter> = jest.fn().mockResolvedValue(mountedChart());
      const runtime = createChartRuntime(document.createElement('div'), mount);
      await runtime.reconcile(request({ backend, payloadKey: backend }));
      expect(mount).toHaveBeenCalledWith(expect.objectContaining({ backend }));
    }
  });
});
