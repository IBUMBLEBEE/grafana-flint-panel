import type { ChartAssemblyInput } from 'flint-chart';

import { createFrameworkOverride } from '../src/flint/frameworkOverride';
import { expect, test } from './fixtures';
import { ChartJsDriver, EChartsDriver, PlotlyDriver, VegaLiteDriver } from './helpers/chartBackend';

const optionalAiTest = process.env.FLINT_AI_E2E === 'true' ? test : test.skip;

test('should display "No data" in case panel data is empty', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '2' });
  await expect(panelEditPage.panel.locator).toContainText('No data');
});

test('should render a Flint chart when data is passed to the panel', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '1' });

  const chart = page.getByTestId('flint-panel-chart');
  await expect(chart).toBeVisible();
  await expect(chart).toHaveAttribute('data-row-count', '5');
  await expect(chart.locator('canvas')).toBeVisible();
});

test('renders all compatible table frames without a second data selector', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '5' });

  await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-frame-count', '2');
  await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-row-count', '4');
  await expect(page.getByText('Flint compile error')).toHaveCount(0);
  await expect(page.getByTestId('flint-panel-chart').locator('canvas')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Data scope' })).toHaveCount(0);
});

test('renders the complex quarterly performance sample as a grouped multi-series chart', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '6' });

  const chart = page.getByTestId('flint-panel-chart');
  await expect(chart).toHaveAttribute('data-chart-type', 'Grouped Bar Chart');
  await expect(chart).toHaveAttribute('data-frame-count', '1');
  await expect(chart).toHaveAttribute('data-row-count', '4');
  await expect(chart.locator('canvas')).toBeVisible();
  await expect(page.getByText('Flint compile error')).toHaveCount(0);
});

test('keeps ECharts hover and legend interactions active in the Panel', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '6' });
  const chart = page.getByTestId('flint-panel-chart');
  const driver = new EChartsDriver(page, chart);

  await driver.waitReady();
  await driver.hoverDatum(0);
  await driver.expectTooltip(/quarter: Q1/);
  await driver.expectTooltip(/revenue: 1280/);
  await driver.toggleLegend('revenue');
  await driver.expectSeriesState('revenue', false);
});

test('keeps Plotly hover and legend interactions active after backend switching', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '6' });
  await panelEditPage.getCustomOptions('AI Assist').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  await studio.getByRole('combobox', { name: 'UI framework' }).click();
  await page.getByRole('option', { name: /Plotly/ }).click();
  await expect(page.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
  await page.getByTestId('flint-workbench-apply-draft').click();
  await page
    .getByRole('dialog', { name: 'AI Chart Studio' })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  const chart = page.getByTestId('flint-panel-chart');
  const driver = new PlotlyDriver(chart);

  await driver.waitReady();
  await driver.hoverDatum(0);
  await driver.expectTooltip(/Q1|1280/);
  await driver.toggleLegend('revenue');
  await driver.expectSeriesState('revenue', false);
});

test('keeps Chart.js hover and legend interactions active after backend switching', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '6' });
  await panelEditPage.getCustomOptions('AI Assist').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  await studio.getByRole('combobox', { name: 'UI framework' }).click();
  await page.getByRole('option', { name: /Chart\.js/ }).click();
  await expect(page.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
  await page.getByTestId('flint-workbench-apply-draft').click();
  await page
    .getByRole('dialog', { name: 'AI Chart Studio' })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  const driver = new ChartJsDriver(page, page.getByTestId('flint-panel-chart'));

  await driver.waitReady();
  await driver.hoverDatum(0);
  await driver.expectTooltip(/Q1/);
  await driver.toggleLegend('revenue');
  await driver.expectSeriesState('revenue', false);
});

test('keeps Vega-Lite hover and legend interactions active after backend switching', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '6' });
  await panelEditPage.getCustomOptions('AI Assist').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  await studio.getByRole('combobox', { name: 'UI framework' }).click();
  await page.getByRole('option', { name: /Vega-Lite/ }).click();
  await expect(page.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
  await page.getByTestId('flint-workbench-apply-draft').click();
  await page
    .getByRole('dialog', { name: 'AI Chart Studio' })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  const driver = new VegaLiteDriver(page, page.getByTestId('flint-panel-chart'));

  await driver.waitReady();
  await driver.hoverDatum(0);
  await driver.expectTooltip(/Q[1-4]/);
  await driver.toggleLegend('revenue');
  await driver.expectSeriesState('revenue', false);
});

test('keeps Hover and Legend active for every backend in the Studio preview', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  test.setTimeout(60_000);
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '6' });
  await panelEditPage.getCustomOptions('AI Assist').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  const chart = page.getByTestId('flint-ai-dialog-chart');

  const echarts = new EChartsDriver(page, chart);
  await echarts.waitReady();
  await echarts.hoverDatum(0);
  await echarts.expectTooltip(/revenue: 1280/);
  await echarts.toggleLegend('revenue');
  await echarts.expectSeriesState('revenue', false);

  const selectBackend = async (name: RegExp) => {
    await studio.getByRole('combobox', { name: 'UI framework' }).click();
    await page.getByRole('option', { name }).click();
  };

  await selectBackend(/Plotly/);
  const plotly = new PlotlyDriver(chart);
  await plotly.waitReady();
  await plotly.hoverDatum(0);
  await plotly.expectTooltip(/Q1|1280/);
  await plotly.toggleLegend('revenue');
  await plotly.expectSeriesState('revenue', false);

  await selectBackend(/Chart\.js/);
  const chartjs = new ChartJsDriver(page, chart);
  await chartjs.waitReady();
  await chartjs.hoverDatum(0);
  await chartjs.expectTooltip(/Q1/);
  await chartjs.toggleLegend('revenue');
  await chartjs.expectSeriesState('revenue', false);

  await selectBackend(/Vega-Lite/);
  const vegalite = new VegaLiteDriver(page, chart);
  await vegalite.waitReady();
  await vegalite.hoverDatum(0);
  await vegalite.expectTooltip(/Q[1-4]/);
  await vegalite.toggleLegend('revenue');
  await vegalite.expectSeriesState('revenue', false);
});

test('renders and configures the 2025 Waterfall demo across Flint backends', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '7' });
  const chart = page.getByTestId('flint-panel-chart');

  await expect(chart).toHaveAttribute('data-chart-type', 'Waterfall Chart');
  await expect(chart).toHaveAttribute('data-render-backend', 'plotly');
  await expect(chart).toHaveAttribute('data-waterfall-totals', 'auto');
  await expect(chart).toHaveAttribute('data-row-count', '12');
  await expect(chart.locator('.plot-container')).toBeVisible();
  await expect(chart).toContainText('How the player base moved through 2025');
  await expect(page.getByText('Flint compile error')).toHaveCount(0);

  await panelEditPage.getCustomOptions('AI Assist').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  await studio.getByRole('tab', { name: 'Chart Settings' }).click();
  const settings = studio.getByRole('tabpanel', { name: 'Chart Settings' });
  await settings.getByRole('combobox', { name: 'Waterfall totals' }).click();
  await page.getByRole('option', { name: 'First and last', exact: true }).click();
  await expect(chart).toHaveAttribute('data-waterfall-totals', 'auto');

  for (const backend of [
    { label: 'Apache ECharts (default)', value: 'echarts' },
    { label: 'Vega-Lite', value: 'vegalite' },
    { label: 'Chart.js', value: 'chartjs' },
    { label: 'Plotly', value: 'plotly' },
  ]) {
    await studio.getByRole('combobox', { name: 'UI framework' }).click();
    await page.getByRole('option', { name: backend.label }).click();
    await expect(page.getByTestId('flint-ai-dialog-chart')).toHaveAttribute('data-render-backend', backend.value);
    await expect(page.getByText('Flint compile error')).toHaveCount(0);
  }

  await expect(page.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
  await page.getByTestId('flint-workbench-apply-draft').click();
  await expect(chart).toHaveAttribute('data-waterfall-totals', 'both');
  await expect(chart).toHaveAttribute('data-render-backend', 'plotly');
});

test('keeps the Plotly dialog preview inside the workbench pane', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  await page.setViewportSize({ width: 1040, height: 650 });
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '7' });

  await panelEditPage.getCustomOptions('AI Assist').expand();
  await page.getByTestId('flint-ai-open-studio').click();

  const previewPane = page.getByTestId('flint-ai-studio').getByRole('region', { name: 'Live preview' });
  const livePreview = page.getByTestId('flint-ai-live-preview');
  const plot = page.getByTestId('flint-ai-dialog-chart').locator('.svg-container');
  await expect(plot).toBeVisible();
  await expect(livePreview).toHaveCSS('overflow', 'hidden');

  const [previewBounds, plotBounds] = await Promise.all([previewPane.boundingBox(), plot.boundingBox()]);
  expect(previewBounds).not.toBeNull();
  expect(plotBounds).not.toBeNull();
  expect(plotBounds!.x + plotBounds!.width).toBeLessThanOrEqual(previewBounds!.x + previewBounds!.width + 1);
});

test('keeps Studio actions and keyboard explanations accessible at supported viewport sizes', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '6' });

  await panelEditPage.getCustomOptions('AI Assist').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  const dialog = page.getByRole('dialog', { name: 'AI Chart Studio' });
  const previewPane = studio.getByRole('region', { name: 'Live preview' });
  const chatPane = studio.getByRole('region', { name: 'AI chat and proposal controls' });

  await studio.getByRole('combobox', { name: 'UI framework' }).click();
  await page.getByRole('option', { name: /Plotly/ }).click();
  await studio.getByRole('tab', { name: 'Flint Spec' }).click();
  const draftEditor = studio.getByRole('tabpanel', { name: 'Flint Spec' }).locator('.monaco-editor[role="code"]');
  await draftEditor.locator('.view-lines').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(
    '{"chartType":"Bar Chart","encodings":{"x":{"field":"quarter"},"y":{"field":"revenue"}}}'
  );
  await expect(page.getByTestId('flint-workbench-apply-draft')).toBeVisible();
  await expect(page.getByTestId('flint-ai-apply-draft')).toHaveCount(0);

  for (const viewport of [
    { width: 1024, height: 640 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const [dialogBounds, previewBounds, chatBounds, applyBounds] = await Promise.all([
      dialog.boundingBox(),
      previewPane.boundingBox(),
      chatPane.boundingBox(),
      page.getByTestId('flint-workbench-apply-draft').boundingBox(),
    ]);

    expect(dialogBounds).not.toBeNull();
    expect(previewBounds).not.toBeNull();
    expect(chatBounds).not.toBeNull();
    expect(applyBounds).not.toBeNull();
    expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBounds!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(dialogBounds!.y + dialogBounds!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(previewBounds!.x + previewBounds!.width).toBeLessThanOrEqual(chatBounds!.x + 1);
    expect(applyBounds!.x).toBeGreaterThanOrEqual(previewBounds!.x);
    expect(applyBounds!.x + applyBounds!.width).toBeLessThanOrEqual(previewBounds!.x + previewBounds!.width + 1);
    await expect
      .poll(() =>
        dialog.evaluate((element) => ({
          horizontal: element.scrollWidth - element.clientWidth,
          vertical: element.scrollHeight - element.clientHeight,
        }))
      )
      .toEqual({ horizontal: 0, vertical: 0 });
  }

  await studio.getByRole('button', { name: 'Discard edits' }).click();
  await studio.getByRole('tab', { name: 'UI Framework Spec' }).click();
  const aboutOverride = studio.getByRole('button', { name: /Generated from the validated Flint Spec/ });
  for (let step = 0; step < 8; step += 1) {
    if (await aboutOverride.evaluate((element) => document.activeElement === element)) {
      break;
    }
    await page.keyboard.press('Tab');
  }
  await expect(aboutOverride).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText('Apply stores only data-free display changes');
});

test('settles the preview after switching from Plotly to Vega-Lite', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  await panelEditPage.getCustomOptions('AI Assist').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');

  await studio.getByRole('combobox', { name: 'UI framework' }).click();
  await page.getByRole('option', { name: /Plotly/ }).click();
  const previewChart = page.getByTestId('flint-ai-dialog-chart');
  await expect(previewChart).toHaveAttribute('data-render-backend', 'plotly');
  await expect(previewChart.locator('.svg-container')).toBeVisible();

  await studio.getByRole('combobox', { name: 'UI framework' }).click();
  await page.getByRole('option', { name: /Vega-Lite/ }).click();

  await expect(previewChart).toHaveAttribute('data-render-backend', 'vegalite');
  await expect(previewChart.locator('canvas')).toBeVisible();
  const draftBar = page.getByTestId('flint-spec-draft-bar');
  await expect(draftBar).toContainText('Preview ready');
  await expect(draftBar).toContainText('Changes are not applied');
});

test('renders and fills the current-panel preview on the first switch to Vega-Lite', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  await page.setViewportSize({ width: 1058, height: 660 });
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '6' });

  await panelEditPage.getCustomOptions('AI Assist').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  const previewChart = page.getByTestId('flint-ai-dialog-chart');
  await expect(previewChart).toHaveAttribute('data-render-backend', 'echarts');

  await studio.getByRole('combobox', { name: 'UI framework' }).click();
  await page.getByRole('option', { name: /Vega-Lite/ }).click();

  await expect(previewChart).toHaveAttribute('data-render-backend', 'vegalite');
  const canvas = previewChart.locator('canvas');
  await expect(canvas).toBeVisible();
  const [previewBounds, canvasBounds] = await Promise.all([previewChart.boundingBox(), canvas.boundingBox()]);
  expect(previewBounds).not.toBeNull();
  expect(canvasBounds).not.toBeNull();
  expect(canvasBounds!.width).toBeGreaterThanOrEqual(previewBounds!.width * 0.8);
  expect(canvasBounds!.height).toBeLessThanOrEqual(previewBounds!.height + 1);
});

test('shows hover details for a Vega-Lite grouped multi-series preview', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '6' });

  await panelEditPage.getCustomOptions('AI Assist').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  await studio.getByRole('combobox', { name: 'UI framework' }).click();
  await page.getByRole('option', { name: /Vega-Lite/ }).click();

  const driver = new VegaLiteDriver(page, page.getByTestId('flint-ai-dialog-chart'));
  await driver.waitReady();
  await driver.hoverDatum(0);
  await driver.expectTooltip(/Q[1-4]/);
  await driver.expectTooltip(/revenue|expenses|profit/);
});

test('settles the Waterfall preview after switching from Plotly to Vega-Lite', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  await page.setViewportSize({ width: 1058, height: 660 });
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '7' });

  await panelEditPage.getCustomOptions('AI Assist').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  const previewChart = page.getByTestId('flint-ai-dialog-chart');
  await expect(previewChart).toHaveAttribute('data-render-backend', 'plotly');

  await studio.getByRole('combobox', { name: 'UI framework' }).click();
  await page.getByRole('option', { name: /Vega-Lite/ }).click();

  await expect(previewChart).toHaveAttribute('data-render-backend', 'vegalite');
  const canvas = previewChart.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByText('Flint compile error')).toHaveCount(0);
  await expect(page.getByText('Preview failed')).toHaveCount(0);

  const [previewBounds, canvasBounds] = await Promise.all([previewChart.boundingBox(), canvas.boundingBox()]);
  expect(previewBounds).not.toBeNull();
  expect(canvasBounds).not.toBeNull();
  expect(canvasBounds!.width).toBeGreaterThanOrEqual(previewBounds!.width * 0.8);
  expect(canvasBounds!.height).toBeLessThanOrEqual(previewBounds!.height + 1);

  const canvasReplacements = await previewChart.evaluate(
    (element) =>
      new Promise<number>((resolve) => {
        let replacements = 0;
        let currentCanvas = element.querySelector('canvas');
        const observer = new MutationObserver(() => {
          const nextCanvas = element.querySelector('canvas');
          if (nextCanvas && currentCanvas && nextCanvas !== currentCanvas) {
            replacements += 1;
          }
          currentCanvas = nextCanvas;
        });
        observer.observe(element, { childList: true, subtree: true });
        window.setTimeout(() => {
          observer.disconnect();
          resolve(replacements);
        }, 1000);
      })
  );
  expect(canvasReplacements).toBe(0);
});

test('uses Chart Settings as the reviewable manual configuration entry', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  const panelChart = page.getByTestId('flint-panel-chart');

  await panelEditPage.getCustomOptions('AI Assist').expand();
  await expect(page.getByTestId('flint-ai-current-chart')).toContainText('Current chart: Auto · Apache ECharts');
  await page.getByTestId('flint-ai-current-chart').hover();
  await expect(page.getByRole('tooltip')).toContainText('1 frame · 5 rows · 3 fields');
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByTestId('flint-ai-open-studio').click();

  const studio = page.getByTestId('flint-ai-studio');
  await expect(studio.getByText('Current Panel', { exact: true })).toHaveCount(0);
  await studio.getByRole('tab', { name: 'Chart Settings' }).click();
  const settings = studio.getByRole('tabpanel', { name: 'Chart Settings' });

  await settings.getByRole('combobox', { name: 'Chart type' }).click();
  await page.getByRole('option', { name: 'Bar Chart', exact: true }).click();
  await settings.getByRole('combobox', { name: 'X field' }).click();
  await page.getByRole('option', { name: 'Label', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Y field' }).click();
  await page.getByRole('option', { name: 'Value', exact: true }).click();

  await expect(page.getByTestId('flint-ai-dialog-chart')).toHaveAttribute('data-chart-type', 'Bar Chart');
  await expect(panelChart).toHaveAttribute('data-chart-type', 'auto');
  const draftBar = page.getByTestId('flint-spec-draft-bar');
  await expect(draftBar).toContainText('Preview ready');
  await expect(draftBar).toContainText('Changes are not applied');
  await expect(page.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
  await page.getByTestId('flint-workbench-apply-draft').click();
  await expect(panelChart).toHaveAttribute('data-chart-type', 'Bar Chart');
});

test('manually edits Flint Spec, applies, and undoes without selecting an AI provider', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  const discardPanelChanges = page.getByRole('button', { name: /^(Discard panel changes|Discard)$/ });
  const panelChart = page.getByTestId('flint-panel-chart');
  await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'auto');
  await expect(discardPanelChanges).toBeDisabled();

  await panelEditPage.getCustomOptions('AI Assist').expand();
  await expect(page.getByTestId('flint-ai-current-chart')).toContainText('Current chart: Auto · Apache ECharts');
  await page.getByTestId('flint-ai-open-studio').click();

  const studio = page.getByTestId('flint-ai-studio');
  const dialog = page.getByRole('dialog', { name: 'AI Chart Studio' });
  // Grafana 12.3's TabsBar does not forward its aria-label; the Studio contains one tablist.
  const workbenchTabs = studio.getByRole('tablist');
  await expect(workbenchTabs.getByRole('tab', { name: 'UI Preview' })).toBeVisible();
  await expect(workbenchTabs.getByRole('tab', { name: 'Chart Settings' })).toBeVisible();
  await expect(workbenchTabs.getByRole('tab', { name: 'Flint Spec' })).toBeVisible();
  await expect(workbenchTabs.getByRole('tab', { name: 'UI Framework Spec' })).toBeVisible();
  await workbenchTabs.getByRole('tab', { name: 'Flint Spec' }).click();
  const flintSpecPanel = studio.getByRole('tabpanel', { name: 'Flint Spec' });
  const flintSpecInspector = flintSpecPanel.getByRole('complementary', { name: 'Flint Spec inspector' });
  await expect(flintSpecInspector).toContainText('Valid Flint Spec');
  const flintSpecEditor = flintSpecPanel.locator('.monaco-editor[role="code"]');
  await expect(flintSpecEditor).toBeVisible();
  expect((await flintSpecEditor.boundingBox())?.height).toBeGreaterThan(240);
  await expect(flintSpecEditor).toContainText('semantic_types');
  await expect(flintSpecEditor).not.toContainText('Current Grafana Panel DataFrame');
  await flintSpecEditor.locator('.view-lines').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(
    '{"chartType":"Bar Chart","encodings":{"x":{"field":"missing"},"y":{"field":"Value"}}}'
  );
  await expect(flintSpecInspector).toContainText('unknown query field "missing"');
  await expect(page.getByTestId('flint-workbench-apply-draft')).toBeDisabled();
  await studio.getByRole('button', { name: 'Discard edits' }).click();
  await expect(page.getByTestId('flint-spec-draft-bar')).toHaveCount(0);
  await workbenchTabs.getByRole('tab', { name: 'UI Framework Spec' }).click();
  await expect(studio.getByRole('complementary', { name: 'UI Framework Spec inspector' })).toContainText(
    'Valid UI Framework Spec'
  );
  await workbenchTabs.getByRole('tab', { name: 'UI Preview' }).click();
  const previewPane = studio.getByRole('region', { name: 'Live preview' });
  const chatPane = studio.getByRole('region', { name: 'AI chat and proposal controls' });
  const previewBounds = await previewPane.boundingBox();
  const chatBounds = await chatPane.boundingBox();
  expect(previewBounds?.x).toBeLessThan(chatBounds?.x ?? 0);
  const paneSeparator = studio.getByRole('separator', { name: 'Resize Chart workbench and AI Chat' });
  await expect(paneSeparator).toHaveAttribute('aria-valuenow', '60');
  const separatorBounds = await paneSeparator.boundingBox();
  expect(separatorBounds).not.toBeNull();
  await page.mouse.move(separatorBounds!.x + separatorBounds!.width / 2, separatorBounds!.y + 100);
  await page.mouse.down();
  await page.mouse.move(separatorBounds!.x - 100, separatorBounds!.y + 100);
  await page.mouse.up();
  const resizedPreviewBounds = await previewPane.boundingBox();
  const resizedChatBounds = await chatPane.boundingBox();
  expect(resizedPreviewBounds!.width).toBeLessThan(previewBounds!.width);
  expect(resizedChatBounds!.width).toBeGreaterThan(chatBounds!.width);
  await paneSeparator.focus();
  await paneSeparator.press('End');
  await expect(paneSeparator).toHaveAttribute('aria-valuenow', '70');
  await studio.getByRole('button', { name: 'Hide AI Chat' }).click();
  await expect(chatPane).toBeHidden();
  await expect(paneSeparator).toBeHidden();
  const collapsedPreviewBounds = await previewPane.boundingBox();
  expect(collapsedPreviewBounds!.width).toBeGreaterThan(resizedPreviewBounds!.width);
  await studio.getByRole('button', { name: 'Show AI Chat' }).click();
  await expect(chatPane).toBeVisible();
  await expect(paneSeparator).toBeVisible();
  await expect(paneSeparator).toHaveAttribute('aria-valuenow', '70');
  await expect(dialog).toHaveCSS('resize', 'both');
  const initialDialogBounds = await dialog.boundingBox();
  await dialog.evaluate((element) => {
    element.style.width = '900px';
    element.style.height = '600px';
  });
  const resizedDialogBounds = await dialog.boundingBox();
  expect(resizedDialogBounds?.width).toBe(900);
  expect(resizedDialogBounds?.height).toBe(600);
  expect(resizedDialogBounds?.width).not.toBe(initialDialogBounds?.width);

  const frameworkSelector = studio.getByRole('combobox', { name: 'UI framework' });
  await frameworkSelector.click();
  await page.getByRole('option', { name: /Chart\.js/ }).click();
  await expect(page.getByTestId('flint-ai-dialog-chart')).toHaveAttribute('data-render-backend', 'chartjs');
  await expect(page.getByTestId('flint-ai-proposal')).toHaveCount(0);
  await workbenchTabs.getByRole('tab', { name: 'Flint Spec' }).click();
  await flintSpecEditor.locator('.view-lines').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText('{"chartType":"Bar Chart","encodings":{"x":{"field":"Label"},"y":{"field":"Value"}}}');
  await expect(page.getByTestId('flint-spec-draft-bar')).toBeVisible();
  await expect(page.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
  await expect(panelChart).toHaveAttribute('data-render-backend', 'echarts');

  await page.getByTestId('flint-workbench-apply-draft').click();
  const successNotice = studio.getByText('Applied the proposal to Panel options.', { exact: true });
  await expect(successNotice).toBeVisible();
  await expect(successNotice).toHaveCount(0, { timeout: 5500 });
  await expect(panelChart).toHaveAttribute('data-render-backend', 'chartjs');
  await expect(panelChart).toHaveAttribute('data-preview-active', 'false');
  await page
    .getByRole('dialog', { name: 'AI Chart Studio' })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await expect(discardPanelChanges).toBeEnabled();

  await page.getByTestId('flint-ai-open-studio').click();
  await expect(page.getByTestId('flint-ai-undo-apply')).toBeEnabled();
  await page.getByTestId('flint-ai-undo-apply').click();
  await expect(panelChart).toHaveAttribute('data-chart-type', 'auto');
  await expect(panelChart).toHaveAttribute('data-render-backend', 'echarts');
});

test('confirms before closing with uncommitted work and discards it only after approval', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  await panelEditPage.getCustomOptions('AI Assist').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const dialog = page.getByRole('dialog', { name: 'AI Chart Studio' });
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  const studio = page.getByTestId('flint-ai-studio');
  await studio.getByRole('tab', { name: 'Flint Spec' }).click();
  const draftEditor = studio.getByRole('tabpanel', { name: 'Flint Spec' }).locator('.monaco-editor[role="code"]');
  await draftEditor.locator('.view-lines').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText('{"chartType":"Bar Chart","encodings":{"x":{"field":"Label"},"y":{"field":"Value"}}}');
  await expect(page.getByTestId('flint-spec-draft-bar')).toBeVisible();

  page.once('dialog', async (confirmation) => {
    expect(confirmation.type()).toBe('confirm');
    expect(confirmation.message()).toContain('Discard the current chart proposal');
    await confirmation.dismiss();
  });
  await close.click();
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('flint-spec-draft-bar')).toBeVisible();

  page.once('dialog', async (confirmation) => {
    expect(confirmation.message()).toContain('Discard the current chart proposal');
    await confirmation.accept();
  });
  await close.click();
  await expect(dialog).toBeHidden();

  await page.getByTestId('flint-ai-open-studio').click();
  await expect(page.getByTestId('flint-ai-proposal')).toHaveCount(0);
  await expect(page.getByTestId('flint-spec-draft-bar')).toHaveCount(0);
  await expect(page.getByTestId('flint-ai-dialog-chart')).toHaveAttribute('data-chart-type', 'auto');
});

test('edits, validates, and applies a data-free Flint Spec without opening preview', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  const discardPanelChanges = page.getByRole('button', { name: /^(Discard panel changes|Discard)$/ });

  await panelEditPage.getCustomOptions('AI Assist').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  await studio.getByRole('tab', { name: 'Flint Spec' }).click();
  const specPanel = studio.getByRole('tabpanel', { name: 'Flint Spec' });
  const specEditor = specPanel.locator('.monaco-editor[role="code"]');
  const specInspector = specPanel.getByRole('complementary', { name: 'Flint Spec inspector' });

  await specEditor.locator('.view-lines').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(
    '{"chartType":"Pie Chart","encodings":{"color":{"field":"Label"},"size":{"field":"Value"}}}'
  );

  await expect(specInspector).toContainText('Pie Chart');
  await expect(specInspector).toContainText('Valid Flint Spec');
  await expect(page.getByTestId('flint-spec-draft-bar')).toContainText(
    'Preview ready · Flint Spec changes are not applied.'
  );
  await expect(page.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
  await page.getByTestId('flint-workbench-apply-draft').click();

  await expect(page.getByTestId('flint-spec-draft-bar')).toHaveCount(0);
  await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'Pie Chart');
  await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-preview-active', 'false');
  await expect(page.getByText('Flint compile error')).toHaveCount(0);
  await page
    .getByRole('dialog', { name: 'AI Chart Studio' })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await expect(discardPanelChanges).toBeEnabled();
});

test('edits and applies the compiled UI Framework Spec while keeping data runtime-owned', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  await panelEditPage.getCustomOptions('AI Assist').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  await studio.getByRole('tab', { name: 'UI Framework Spec' }).click();
  const frameworkPanel = studio.getByRole('tabpanel', { name: 'UI Framework Spec' });
  const frameworkEditor = frameworkPanel.locator('.monaco-editor[role="code"]');
  const frameworkInspector = frameworkPanel.getByRole('complementary', { name: 'UI Framework Spec inspector' });

  await expect(frameworkInspector).toContainText('Valid UI Framework Spec');
  await frameworkEditor.locator('.view-lines').click();
  await page.keyboard.press('Control+f');
  const findInput = frameworkPanel.getByRole('textbox', { name: 'Find' });
  await findInput.fill('"trigger": "axis"');
  await frameworkPanel.getByRole('button', { name: 'Toggle Replace' }).click();
  await frameworkPanel.getByRole('textbox', { name: 'Replace' }).fill('"trigger": "item"');
  await frameworkPanel.getByRole('button', { name: /^Replace \(/ }).click();
  await frameworkPanel.getByRole('button', { name: 'Close (Escape)' }).click();

  await expect(frameworkInspector).toContainText('Valid UI Framework Spec');
  await frameworkInspector.getByRole('button', { name: /Generated from the validated Flint Spec/ }).hover();
  await expect(page.getByRole('tooltip')).toContainText('Apply stores only data-free display changes');
  await expect(page.getByTestId('flint-spec-draft-bar')).toContainText(
    'Preview ready · UI Framework Spec changes are not applied.'
  );
  await expect(page.getByTestId('flint-ai-proposal')).toHaveCount(0);
  await expect(page.getByTestId('flint-ai-apply-draft')).toHaveCount(0);
  await expect(page.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
  await page.getByTestId('flint-workbench-apply-draft').click();

  await expect(page.getByTestId('flint-spec-draft-bar')).toHaveCount(0);
  await studio.getByRole('tab', { name: 'UI Framework Spec' }).click();
  await expect(studio.getByRole('complementary', { name: 'UI Framework Spec inspector' })).toContainText(
    'Saved override applied'
  );
  await expect(studio.getByRole('tabpanel', { name: 'UI Framework Spec' })).toContainText('"trigger": "item"');

  await studio.getByRole('button', { name: 'Reset override' }).click();
  await expect(page.getByTestId('flint-spec-draft-bar')).toContainText(
    'Preview ready · UI Framework Spec changes are not applied.'
  );
  await expect(page.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
  await page.getByTestId('flint-workbench-apply-draft').click();
  await expect(page.getByTestId('flint-spec-draft-bar')).toHaveCount(0);
  await studio.getByRole('tab', { name: 'UI Framework Spec' }).click();
  await expect(studio.getByRole('complementary', { name: 'UI Framework Spec inspector' })).toContainText(
    'Valid UI Framework Spec'
  );
  await expect(studio.getByRole('tabpanel', { name: 'UI Framework Spec' })).toContainText('"trigger": "axis"');
});

test('persists a data-free Framework Override through query-value refresh and dashboard reload', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  request,
  page,
}) => {
  const source = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const sourceResponse = await request.get(`/api/dashboards/uid/${source.uid}`, { timeout: 10_000 });
  expect(sourceResponse.ok()).toBe(true);
  const sourceBody = (await sourceResponse.json()) as {
    dashboard: {
      panels: Array<{
        id: number;
        options: Record<string, unknown>;
        targets?: Array<Record<string, unknown> & { rawFrameContent?: string }>;
      }>;
    } & Record<string, unknown>;
  };
  const sourcePanel = sourceBody.dashboard.panels.find((panel) => panel.id === 1);
  expect(sourcePanel).toBeDefined();
  const input: ChartAssemblyInput = {
    data: {
      values: [
        { Time: 1609459200000, Label: 'A', Value: 10 },
        { Time: 1609462800000, Label: 'B', Value: 20 },
      ],
    },
    semantic_types: { Time: 'Date', Label: 'Category', Value: 'Quantity' },
    options: { addTooltips: true },
    chart_spec: {
      chartType: 'Line Chart',
      encodings: {
        x: { field: 'Time', type: 'temporal' },
        y: { field: 'Value', type: 'quantitative' },
        color: { field: 'Label', type: 'nominal' },
      },
      canvasSize: { width: 800, height: 450 },
      baseSize: { width: 800, height: 450 },
    },
  };
  const override = createFrameworkOverride({
    backend: 'echarts',
    input,
    generated: { tooltip: { trigger: 'axis' } },
    edited: { tooltip: { trigger: 'item' } },
  });
  expect(override).toBeDefined();
  const copy = {
    ...sourceBody.dashboard,
    id: null,
    uid: null,
    title: `Flint override persistence ${Date.now()}`,
    version: 0,
    panels: sourceBody.dashboard.panels.map((panel) =>
      panel.id === 1 ? { ...panel, options: { ...panel.options, frameworkOverrides: { echarts: override } } } : panel
    ),
  };
  const createResponse = await request.post('/api/dashboards/db', {
    data: { dashboard: copy, folderId: 0, overwrite: false },
    timeout: 10_000,
  });
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as { uid: string };

  try {
    const savedResponse = await request.get(`/api/dashboards/uid/${created.uid}`, { timeout: 10_000 });
    const savedBody = (await savedResponse.json()) as {
      dashboard: {
        panels: Array<{
          id: number;
          options: Record<string, unknown>;
          targets?: Array<Record<string, unknown> & { rawFrameContent?: string }>;
        }>;
      } & Record<string, unknown>;
    };
    const savedOptions = savedBody.dashboard.panels.find((panel) => panel.id === 1)?.options;
    const overrides = savedOptions?.frameworkOverrides as {
      echarts?: { patch?: Array<{ path: string; value?: unknown }> };
    };
    expect(overrides.echarts?.patch).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: '/tooltip/trigger', value: 'item' })])
    );
    expect(JSON.stringify(overrides)).not.toContain('1609459200000');
    expect(JSON.stringify(overrides)).not.toContain('"rows"');

    const refreshedDashboard = {
      ...savedBody.dashboard,
      panels: savedBody.dashboard.panels.map((panel) =>
        panel.id === 1
          ? {
              ...panel,
              targets: panel.targets?.map((target) => ({
                ...target,
                rawFrameContent: target.rawFrameContent?.replace(
                  '[1609459200000, "A", 10]',
                  '[1609459200000, "A", 110]'
                ),
              })),
            }
          : panel
      ),
    };
    expect(JSON.stringify(refreshedDashboard)).toContain('[1609459200000, \\"A\\", 110]');
    const refreshResponse = await request.post('/api/dashboards/db', {
      data: { dashboard: refreshedDashboard, folderId: 0, overwrite: true },
      timeout: 10_000,
    });
    expect(refreshResponse.ok()).toBe(true);

    const reopened = await gotoPanelEditPage({ dashboard: { uid: created.uid }, id: '1' });
    await reopened.getCustomOptions('AI Assist').expand();
    await page.getByTestId('flint-ai-open-studio').click();
    const reopenedStudio = page.getByTestId('flint-ai-studio');
    const reopenedFrameworkTab = reopenedStudio.getByRole('tab', { name: 'UI Framework Spec' });
    await reopenedFrameworkTab.click();
    await expect(reopenedStudio.getByRole('complementary', { name: 'UI Framework Spec inspector' })).toContainText(
      'Saved override applied'
    );
    const reopenedFrameworkPanel = reopenedStudio.getByRole('tabpanel', { name: 'UI Framework Spec' });
    await expect(reopenedFrameworkPanel).toContainText('"trigger": "item"');
    const reopenedFrameworkEditor = reopenedFrameworkPanel.locator('.monaco-editor[role="code"]');
    await reopenedFrameworkEditor.locator('.view-lines').click();
    await page.keyboard.press('Control+f');
    await reopenedFrameworkPanel.getByRole('textbox', { name: 'Find' }).fill('110');
    await expect(reopenedFrameworkEditor.locator('.view-lines')).toContainText('110');

    const refreshedResponse = await request.get(`/api/dashboards/uid/${created.uid}`, { timeout: 10_000 });
    expect(refreshedResponse.ok()).toBe(true);
    const refreshedBody = (await refreshedResponse.json()) as typeof savedBody;
    const staleDashboard = {
      ...refreshedBody.dashboard,
      panels: refreshedBody.dashboard.panels.map((panel) => {
        if (panel.id !== 1) {
          return panel;
        }
        const panelOverrides = panel.options.frameworkOverrides as {
          echarts?: Record<string, unknown>;
        };
        return {
          ...panel,
          options: {
            ...panel.options,
            frameworkOverrides: {
              ...panelOverrides,
              echarts: { ...panelOverrides.echarts, compilerVersion: 'future-flint' },
            },
          },
        };
      }),
    };
    const staleResponse = await request.post('/api/dashboards/db', {
      data: { dashboard: staleDashboard, folderId: 0, overwrite: true },
      timeout: 10_000,
    });
    expect(staleResponse.ok()).toBe(true);

    const stalePage = await gotoPanelEditPage({ dashboard: { uid: created.uid }, id: '1' });
    const layoutWarning = page.getByRole('alert').filter({ hasText: 'Flint layout warning' });
    await expect(layoutWarning).toContainText('compiler version changed');
    await expect(page.getByTestId('flint-panel-chart').locator('canvas')).toBeVisible();
    await stalePage.getCustomOptions('AI Assist').expand();
    await page.getByTestId('flint-ai-open-studio').click();
    const staleStudio = page.getByTestId('flint-ai-studio');
    await staleStudio.getByRole('tab', { name: 'UI Framework Spec' }).click();
    const staleInspector = staleStudio.getByRole('complementary', { name: 'UI Framework Spec inspector' });
    await expect(staleInspector).toContainText('Stale override ignored');
    await expect(staleInspector).not.toContainText('Saved override applied');
    const staleDetails = staleInspector.getByRole('button', { name: /compiler version changed/ });
    await staleDetails.hover();
    await expect(page.getByRole('tooltip')).toContainText('compiler version changed');
  } finally {
    await request.delete(`/api/dashboards/uid/${created.uid}`, { timeout: 10_000 });
  }
});

optionalAiTest(
  'keeps the current preview instance and remembers the AI model across reloads',
  async ({ gotoPanelEditPage, readProvisionedDashboard, readProvisionedDataSource, page }) => {
    const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
    const provider = await readProvisionedDataSource({ fileName: 'flint-ai.yml', name: 'Flint AI - Secondary' });
    const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

    await panelEditPage.getCustomOptions('AI Assist').expand();
    await page.getByTestId('flint-ai-open-studio').click();
    const studio = page.getByTestId('flint-ai-studio');
    const chart = page.getByTestId('flint-ai-dialog-chart');
    const canvas = chart.locator('canvas').first();
    await expect(canvas).toBeVisible();
    await canvas.evaluate((element) => element.setAttribute('data-preview-instance', 'before-model-switch'));

    const modelSelector = studio.getByRole('combobox', { name: 'AI model' });
    await modelSelector.click();
    await page.getByRole('option').filter({ hasText: provider.name }).click();

    await expect(chart.locator('canvas[data-preview-instance="before-model-switch"]')).toHaveCount(1);

    const selectedModelLabel = String(provider.jsonData.model ?? provider.name);
    await expect(modelSelector).toHaveValue(selectedModelLabel);

    const reloadedPanelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
    await reloadedPanelEditPage.getCustomOptions('AI Assist').expand();
    await page.getByTestId('flint-ai-open-studio').click();
    await expect(page.getByTestId('flint-ai-studio').getByRole('combobox', { name: 'AI model' })).toHaveValue(
      selectedModelLabel
    );
  }
);

optionalAiTest(
  'Generate tolerates an incompatible optional spec, previews it, and applies it explicitly',
  async ({ gotoPanelEditPage, readProvisionedDashboard, readProvisionedDataSource, page }) => {
    let generateRequest: Record<string, unknown> | undefined;
    const provider = await readProvisionedDataSource({ fileName: 'flint-ai.yml' });
    await page.route(`**/api/datasources/uid/${provider.uid}/resources/**chat`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'I will use that requirement for the proposal.' }),
      });
    });
    await page.route(`**/api/datasources/uid/${provider.uid}/resources/**generate`, async (route) => {
      generateRequest = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          chartType: 'bar',
          xField: '',
          yField: '',
          colorField: '',
          specJson: JSON.stringify({
            mark: 'bar',
            encoding: {
              x: { field: 'region', type: 'nominal' },
              y: { field: 'revenue', type: 'quantitative' },
            },
          }),
          rationale: 'Bar chart is appropriate for comparing revenue across regions.',
        }),
      });
    });

    const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
    const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
    const businessDataSource = await readProvisionedDataSource({ fileName: 'datasources.yml', name: 'TestData DB' });
    await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'auto');

    await panelEditPage.getCustomOptions('AI Assist').expand();
    await page.getByTestId('flint-ai-open-studio').click();
    const modelSelector = page.getByTestId('flint-ai-composer').getByRole('combobox', { name: 'AI model' });
    await expect(modelSelector).toBeVisible();
    await expect(page.getByTestId('flint-ai-composer').getByRole('button', { name: 'Clear chat' })).toHaveCount(0);
    await expect(page.getByTestId('flint-ai-studio').getByRole('button', { name: 'Auto' })).toHaveCount(0);
    await modelSelector.click();
    await page.getByRole('option').filter({ hasText: provider.name }).click();
    await expect(modelSelector).toHaveValue(/.+/);
    await page.getByRole('textbox', { name: 'Message' }).fill('show this as bars');
    await page.getByTestId('flint-ai-composer').getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByTestId('flint-ai-chat-thread')).toContainText(
      'I will use that requirement for the proposal.'
    );
    await page.getByTestId('flint-ai-generate').click();

    await expect(page.getByTestId('flint-ai-apply-draft')).toBeVisible();
    await expect(page.getByText('Invalid Flint spec JSON: chart_spec requires chartType')).toHaveCount(0);
    await expect(page.getByTestId('flint-ai-dialog-chart')).toHaveAttribute('data-chart-type', 'Bar Chart');
    await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'auto');
    await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-preview-active', 'false');
    expect(generateRequest).toMatchObject({
      prompt: 'show this as bars',
      suggestedChartType: expect.any(String),
      renderBackend: 'echarts',
      chartCatalog: expect.arrayContaining([
        expect.objectContaining({ chartType: 'Pie Chart', channels: expect.arrayContaining(['size', 'color']) }),
      ]),
      frameSummary: expect.arrayContaining([
        expect.objectContaining({ refId: expect.any(String), frameIndex: expect.any(Number) }),
      ]),
    });
    expect(JSON.stringify(generateRequest)).not.toContain(businessDataSource.uid);
    expect(generateRequest).not.toHaveProperty('apiKey');
    expect(generateRequest).not.toHaveProperty('baseUrl');

    await page.getByTestId('flint-ai-apply-draft').click();
    await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'Bar Chart');
    await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-preview-active', 'false');
  }
);

optionalAiTest(
  'AI Chat is advisory and keeps the current Panel unchanged',
  async ({ gotoPanelEditPage, readProvisionedDashboard, readProvisionedDataSource, page }) => {
    let chatRequest: Record<string, unknown> | undefined;
    const provider = await readProvisionedDataSource({ fileName: 'flint-ai.yml' });
    await page.route(`**/api/datasources/uid/${provider.uid}/resources/**chat`, async (route) => {
      chatRequest = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message:
            '**Read-only:** A waterfall chart makes monthly gains and losses easy to compare. Use `Generate proposal` to stage the change.',
        }),
      });
    });

    const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
    const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
    await panelEditPage.getCustomOptions('AI Assist').expand();
    await page.getByTestId('flint-ai-open-studio').click();
    const modelSelector = page.getByTestId('flint-ai-composer').getByRole('combobox', { name: 'AI model' });
    await expect(modelSelector).toBeVisible();
    await modelSelector.click();
    await page.getByRole('option').filter({ hasText: provider.name }).click();
    await expect(page.getByTestId('flint-assistant-ui-thread')).toBeVisible();
    await page.getByRole('textbox', { name: 'Message' }).fill('Why would I use a waterfall chart?');
    await page.getByTestId('flint-ai-composer').getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByTestId('flint-ai-chat-thread')).toContainText('Why would I use a waterfall chart?');
    await expect(page.getByTestId('flint-ai-chat-thread')).toContainText('monthly gains and losses');
    await expect(page.getByTestId('flint-ai-chat-thread').getByText('Read-only:', { exact: true })).toHaveCount(1);
    await expect(page.getByTestId('flint-ai-chat-thread').getByText('Generate proposal', { exact: true })).toHaveCount(
      1
    );
    await expect(page.getByRole('alert').filter({ hasText: 'Read-only:' })).toHaveCount(0);
    await expect(page.getByTestId('flint-ai-proposal')).toHaveCount(0);
    await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'auto');
    expect(chatRequest).toMatchObject({
      messages: [{ role: 'user', content: 'Why would I use a waterfall chart?' }],
      panelContext: { fields: expect.any(Array), renderBackend: 'echarts' },
    });
    expect(chatRequest).not.toHaveProperty('apiKey');
    expect(chatRequest).not.toHaveProperty('baseUrl');

    const composer = page.getByTestId('flint-ai-composer');
    await expect(composer.getByRole('button', { name: 'Clear chat' })).toHaveCount(0);
    const clearChat = page.getByRole('button', { name: 'Clear chat' });
    await expect(clearChat).toBeEnabled();
    await clearChat.click();
    await expect(page.getByTestId('flint-ai-chat-thread')).not.toContainText('Why would I use a waterfall chart?');
  }
);

test('AI Chat keeps proposal generation in the header and aligns Send with the model selector', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  await panelEditPage.getCustomOptions('AI Assist').expand();
  await page.getByTestId('flint-ai-open-studio').click();

  const studio = page.getByTestId('flint-ai-studio');
  const chatPane = studio.getByRole('region', { name: 'AI chat and proposal controls' });
  const composer = page.getByTestId('flint-ai-composer');
  const messageComposer = composer.getByRole('group', { name: 'Message composer' });

  await expect(messageComposer.getByRole('textbox', { name: 'Message' })).toBeVisible();
  const sendMessage = messageComposer.getByRole('button', { name: 'Send message' });
  const modelSelector = messageComposer.getByRole('combobox', { name: 'AI model' });
  await expect(sendMessage).toBeVisible();
  await expect(modelSelector).toBeVisible();
  await expect(composer.getByTestId('flint-ai-generate')).toHaveCount(0);

  const [sendBounds, modelBounds] = await Promise.all([sendMessage.boundingBox(), modelSelector.boundingBox()]);
  expect(sendBounds).not.toBeNull();
  expect(modelBounds).not.toBeNull();
  expect(
    Math.abs(sendBounds!.y + sendBounds!.height / 2 - (modelBounds!.y + modelBounds!.height / 2))
  ).toBeLessThanOrEqual(1);

  const generateProposal = chatPane.getByRole('button', { name: 'Generate chart proposal' });
  await expect(generateProposal).toBeVisible();
  await expect(generateProposal).toBeDisabled();
  await expect(studio.getByRole('button', { name: 'Auto' })).toHaveCount(0);
  await generateProposal.hover();
  await expect(page.getByRole('tooltip')).toContainText(
    'Generate a reviewable chart proposal from the sent conversation.'
  );
});
