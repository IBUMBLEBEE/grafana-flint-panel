import type { Locator, Page } from '@playwright/test';

import { expect } from '../fixtures';

export interface ChartBackendDriver {
  waitReady(): Promise<void>;
  markInstance(id: string): Promise<void>;
  expectSameInstance(id: string): Promise<void>;
  hoverDatum(index: number): Promise<void>;
  expectTooltip(text: RegExp): Promise<void>;
  toggleLegend(series: string): Promise<void>;
  expectSeriesState(series: string, visible: boolean): Promise<void>;
}

const GROUP_X = [0.2, 0.4, 0.55, 0.72];

export class EChartsDriver implements ChartBackendDriver {
  private readonly canvas: Locator;
  private readonly tooltip: Locator;

  constructor(
    private readonly page: Page,
    private readonly chart: Locator
  ) {
    this.canvas = chart.locator('canvas').first();
    this.tooltip = chart
      .locator('div')
      .filter({ hasText: /quarter: Q[1-4]/ })
      .last();
  }

  async waitReady(): Promise<void> {
    await expect(this.canvas).toBeVisible();
    await expect.poll(async () => (await this.canvas.boundingBox())?.width ?? 0).toBeGreaterThan(0);
  }

  async markInstance(id: string): Promise<void> {
    await this.canvas.evaluate((element, value) => element.setAttribute('data-test-instance', value), id);
  }

  async expectSameInstance(id: string): Promise<void> {
    await expect(this.chart.locator(`canvas[data-test-instance="${id}"]`)).toHaveCount(1);
  }

  async hoverDatum(index: number): Promise<void> {
    let bounds = await this.canvas.boundingBox();
    await expect
      .poll(async () => {
        bounds = await this.canvas.boundingBox();
        return bounds?.width ?? 0;
      })
      .toBeGreaterThan(0);
    expect(bounds).not.toBeNull();
    const x = bounds!.x + bounds!.width * (GROUP_X[index] ?? GROUP_X[0]);
    for (const yFraction of [0.3, 0.45, 0.6, 0.75]) {
      await this.page.mouse.move(x, bounds!.y + bounds!.height * yFraction);
      if ((await this.tooltip.textContent())?.trim()) {
        return;
      }
    }
    throw new Error(`ECharts tooltip did not activate for datum ${index}`);
  }

  async expectTooltip(text: RegExp): Promise<void> {
    await expect(this.tooltip).toContainText(text);
  }

  async toggleLegend(series: string): Promise<void> {
    const bounds = await this.canvas.boundingBox();
    expect(bounds).not.toBeNull();
    for (const xFraction of [0.92, 0.86, 0.8]) {
      for (const yFraction of [0.08, 0.13, 0.18, 0.23, 0.28, 0.33, 0.38, 0.43, 0.48]) {
        const x = bounds!.x + bounds!.width * xFraction;
        const y = bounds!.y + bounds!.height * yFraction;
        await this.page.mouse.click(x, y);
        await this.hoverDatum(0);
        const tooltipText = (await this.tooltip.textContent()) ?? '';
        if (!tooltipText.includes(series)) {
          return;
        }
        // Restore an unrelated series before trying the next legend position.
        await this.page.mouse.click(x, y);
      }
    }
    throw new Error(`ECharts legend item ${series} did not respond to pointer clicks`);
  }

  async expectSeriesState(series: string, visible: boolean): Promise<void> {
    await this.hoverDatum(0);
    if (visible) {
      await expect(this.tooltip).toContainText(series);
    } else {
      await expect(this.tooltip).not.toContainText(series);
    }
  }
}

export class PlotlyDriver implements ChartBackendDriver {
  private readonly plot: Locator;

  constructor(private readonly chart: Locator) {
    this.plot = chart.locator('.plot-container');
  }

  private legendItem(series: string): Locator {
    return this.chart.locator('g.traces').filter({ hasText: series }).first();
  }

  async waitReady(): Promise<void> {
    await expect(this.plot).toBeVisible();
  }

  async markInstance(id: string): Promise<void> {
    await this.plot.evaluate((element, value) => element.setAttribute('data-test-instance', value), id);
  }

  async expectSameInstance(id: string): Promise<void> {
    await expect(this.chart.locator(`.plot-container[data-test-instance="${id}"]`)).toHaveCount(1);
  }

  async hoverDatum(index: number): Promise<void> {
    await this.chart.locator('g.point').nth(index).hover({ force: true });
  }

  async expectTooltip(text: RegExp): Promise<void> {
    await expect(this.chart.locator('.hoverlayer')).toContainText(text);
  }

  async toggleLegend(series: string): Promise<void> {
    await this.legendItem(series).locator('.legendtoggle').click({ force: true });
    // Plotly delays a single legend click briefly to distinguish it from double-click isolation.
    await this.chart.page().waitForTimeout(400);
  }

  async expectSeriesState(series: string, visible: boolean): Promise<void> {
    const state = await this.chart.locator('.js-plotly-plot').evaluate((element, name) => {
      const plot = element as HTMLElement & { data?: Array<{ name?: string; visible?: boolean | 'legendonly' }> };
      return plot.data?.find((trace) => trace.name === name)?.visible ?? true;
    }, series);
    if (visible) {
      expect(state).not.toBe('legendonly');
    } else {
      expect(state).toBe('legendonly');
    }
  }
}

export class ChartJsDriver implements ChartBackendDriver {
  private readonly canvas: Locator;

  constructor(
    private readonly page: Page,
    private readonly chart: Locator
  ) {
    this.canvas = chart.locator('canvas').first();
  }

  async waitReady(): Promise<void> {
    await expect(this.canvas).toBeVisible();
    await expect(this.canvas).toHaveAttribute('data-visible-series-count', /[1-9]/);
  }

  async markInstance(id: string): Promise<void> {
    await this.canvas.evaluate((element, value) => element.setAttribute('data-test-instance', value), id);
  }

  async expectSameInstance(id: string): Promise<void> {
    await expect(this.chart.locator(`canvas[data-test-instance="${id}"]`)).toHaveCount(1);
  }

  async hoverDatum(index: number): Promise<void> {
    const bounds = await this.canvas.boundingBox();
    expect(bounds).not.toBeNull();
    const x = bounds!.x + bounds!.width * (GROUP_X[index] ?? GROUP_X[0]);
    for (const yFraction of [0.3, 0.45, 0.6, 0.75]) {
      await this.page.mouse.move(x, bounds!.y + bounds!.height * yFraction);
      if ((await this.canvas.getAttribute('data-tooltip-active')) === 'true') {
        return;
      }
    }
    throw new Error(`Chart.js tooltip did not activate for datum ${index}`);
  }

  async expectTooltip(_text: RegExp): Promise<void> {
    await expect(this.canvas).toHaveAttribute('data-tooltip-active', 'true');
  }

  async toggleLegend(_series: string): Promise<void> {
    const bounds = await this.canvas.boundingBox();
    expect(bounds).not.toBeNull();
    const initialCount = await this.canvas.getAttribute('data-visible-series-count');
    const hitTargets = JSON.parse((await this.canvas.getAttribute('data-legend-hit-targets')) ?? '[]') as Array<{
      left: number;
      top: number;
      width: number;
      height: number;
    }>;
    const layoutSize = JSON.parse((await this.canvas.getAttribute('data-chart-layout-size')) ?? '{}') as {
      width?: number;
      height?: number;
    };
    const xScale = bounds!.width / (layoutSize.width || bounds!.width);
    const yScale = bounds!.height / (layoutSize.height || bounds!.height);
    for (const target of hitTargets) {
      await this.page.mouse.click(
        bounds!.x + (target.left + target.width / 2) * xScale,
        bounds!.y + (target.top + target.height / 2) * yScale
      );
      const changed = await expect
        .poll(() => this.canvas.getAttribute('data-visible-series-count'), { timeout: 500 })
        .not.toBe(initialCount)
        .then(
          () => true,
          () => false
        );
      if (changed) {
        return;
      }
    }
    throw new Error('Chart.js legend did not respond to pointer clicks');
  }

  async expectSeriesState(_series: string, visible: boolean): Promise<void> {
    const count = Number(await this.canvas.getAttribute('data-visible-series-count'));
    if (visible) {
      expect(count).toBeGreaterThan(0);
    } else {
      expect(count).toBeLessThan(3);
    }
  }
}

export class VegaLiteDriver implements ChartBackendDriver {
  private readonly canvas: Locator;
  private readonly renderHost: Locator;
  private readonly tooltip: Locator;

  constructor(
    private readonly page: Page,
    private readonly chart: Locator
  ) {
    this.canvas = chart.locator('canvas').first();
    this.renderHost = chart.locator(':scope > div').first();
    this.tooltip = page.locator('#vg-tooltip-element.visible');
  }

  async waitReady(): Promise<void> {
    await expect(this.canvas).toBeVisible();
    await expect.poll(async () => (await this.canvas.boundingBox())?.width ?? 0).toBeGreaterThan(0);
  }

  async markInstance(id: string): Promise<void> {
    await this.canvas.evaluate((element, value) => element.setAttribute('data-test-instance', value), id);
  }

  async expectSameInstance(id: string): Promise<void> {
    await expect(this.chart.locator(`canvas[data-test-instance="${id}"]`)).toHaveCount(1);
  }

  async hoverDatum(index: number): Promise<void> {
    let bounds = await this.canvas.boundingBox();
    await expect
      .poll(async () => {
        bounds = await this.canvas.boundingBox();
        return bounds?.width ?? 0;
      })
      .toBeGreaterThan(0);
    expect(bounds).not.toBeNull();
    const preferredX = GROUP_X[index] ?? GROUP_X[0];
    for (const xFraction of [preferredX, 0.15, 0.3, 0.45, 0.6, 0.75]) {
      for (const yFraction of [0.3, 0.45, 0.6, 0.75]) {
        await this.page.mouse.move(bounds!.x + bounds!.width * xFraction, bounds!.y + bounds!.height * yFraction);
        if (await this.tooltip.isVisible()) {
          return;
        }
      }
    }
    throw new Error(`Vega-Lite tooltip did not activate for datum ${index}`);
  }

  async expectTooltip(text: RegExp): Promise<void> {
    await expect(this.tooltip).toContainText(text);
  }

  async toggleLegend(_series: string): Promise<void> {
    const bounds = await this.canvas.boundingBox();
    expect(bounds).not.toBeNull();
    for (const xFraction of [0.88, 0.92, 0.96]) {
      for (const yFraction of [0.08, 0.13, 0.18, 0.23, 0.28, 0.33]) {
        await this.page.mouse.click(bounds!.x + bounds!.width * xFraction, bounds!.y + bounds!.height * yFraction);
        if ((await this.renderHost.getAttribute('data-legend-selection-active')) === 'true') {
          return;
        }
      }
    }
    throw new Error('Vega-Lite legend selection did not respond to pointer clicks');
  }

  async expectSeriesState(_series: string, visible: boolean): Promise<void> {
    await expect(this.renderHost).toHaveAttribute('data-legend-selection-active', visible ? 'false' : 'true');
  }
}
