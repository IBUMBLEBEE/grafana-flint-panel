import { expect, test } from './fixtures';

test('configures multiple measures and chart options, applies and switches charts without AI', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const aiRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/resources\/(generate|repair|chat|plan)(\?|$)/.test(request.url())) {
      aiRequests.push(request.url());
    }
  });
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const edit = await gotoPanelEditPage({ dashboard, id: '6' });
  await edit.getCustomOptions('Chart settings').expand();
  await page.getByRole('button', { name: 'Open Chart workbench' }).click();
  const studio = page.getByTestId('flint-ai-studio');
  await studio.getByRole('tab', { name: 'Chart Settings' }).click();
  const settings = studio.getByRole('tabpanel', { name: 'Chart Settings' });
  await settings.getByRole('combobox', { name: 'Chart type' }).click();
  await page.getByRole('option', { name: 'Line Chart', exact: true }).click();
  const values = settings.getByRole('combobox', { name: 'Y field' });
  await values.fill('profit');
  await page.getByRole('option', { name: 'profit number', exact: true }).click();
  await values.fill('revenue');
  await page.getByRole('option', { name: 'revenue number', exact: true }).click();
  await values.press('Escape');
  await settings.getByRole('combobox', { name: 'Points', exact: true }).click();
  await page.getByRole('option', { name: 'On', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Tooltip', exact: true }).click();
  await page.getByRole('option', { name: 'Off', exact: true }).click();
  await expect(page.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
  await studio.getByRole('tab', { name: 'Flint Spec', exact: true }).click();
  const spec = studio.locator('.monaco-editor').first();
  await expect(spec).toContainText('profit');
  await expect(spec).toContainText('showPoints');
  await page.getByTestId('flint-workbench-apply-draft').click();
  await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'Line Chart');
  await studio.getByRole('tab', { name: 'Chart Settings' }).click();
  await settings.getByRole('combobox', { name: 'Chart type' }).click();
  await page.getByRole('option', { name: 'Stacked Bar Chart', exact: true }).click();
  await expect(settings).toContainText('profit, revenue');
  await settings.getByRole('combobox', { name: 'Stack', exact: true }).click();
  await page.getByRole('option', { name: /Normalize/ }).click();
  await expect(page.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
  await page.getByTestId('flint-workbench-apply-draft').click();
  await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'Stacked Bar Chart');
  await page
    .getByRole('dialog', { name: 'Chart workbench' })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.getByRole('button', { name: 'Open Chart workbench' }).click();
  await studio.getByRole('tab', { name: 'Chart Settings' }).click();
  await expect(settings).toContainText('profit, revenue');
  await expect(settings.getByRole('combobox', { name: 'Tooltip', exact: true })).toHaveValue('Off');
  expect(aiRequests).toEqual([]);
});

test('keeps expanded additional field mappings inside the settings card', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const edit = await gotoPanelEditPage({ dashboard, id: '6' });
  await edit.getCustomOptions('Chart settings').expand();
  await page.getByRole('button', { name: 'Open Chart workbench' }).click();
  const studio = page.getByTestId('flint-ai-studio');
  await studio.getByRole('tab', { name: 'Chart Settings' }).click();
  const settings = studio.getByRole('tabpanel', { name: 'Chart Settings' });
  await settings.getByRole('combobox', { name: 'Chart type' }).click();
  await page.getByRole('option', { name: 'Heatmap', exact: true }).click();
  const extra = settings.locator('details');
  await extra.locator('summary').click();
  for (const dialogWidth of [1100, 900, 740]) {
    await page.getByRole('dialog', { name: 'Chart workbench' }).evaluate((element, width) => {
      element.style.width = `${width}px`;
    }, dialogWidth);
    await expect
      .poll(async () =>
        extra.evaluate((element) => {
          const card = element.parentElement!.getBoundingClientRect();
          const fields = Array.from(element.querySelectorAll('input[role="combobox"]'));
          return fields.every((field) => {
            const bounds = field.getBoundingClientRect();
            return bounds.left >= card.left && bounds.right <= card.right;
          });
        })
      )
      .toBe(true);
  }
});

test('keeps chart bounds stable from draft actions through Apply and notice dismissal', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const edit = await gotoPanelEditPage({ dashboard, id: '6' });
  await edit.getCustomOptions('Chart settings').expand();
  await page.getByRole('button', { name: 'Open Chart workbench' }).click();
  const studio = page.getByTestId('flint-ai-studio');
  const initialChart = studio.getByRole('region', { name: 'Live preview' }).locator('canvas').first();
  await expect(initialChart).toBeVisible();
  const beforeNotice = await initialChart.boundingBox();
  await studio.getByRole('tab', { name: 'Chart Settings' }).click();
  await studio.getByRole('combobox', { name: 'Tooltip', exact: true }).click();
  await page.getByRole('option', { name: 'Off', exact: true }).click();
  await expect(studio.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
  await studio.getByRole('tab', { name: 'UI Preview', exact: true }).click();
  await expect.poll(async () => initialChart.boundingBox()).toEqual(beforeNotice);
  const [transitionBounds] = await Promise.all([
    studio.evaluate(async (element) => {
      const samples = [];
      for (let i = 0; i < 30; i++) {
        const canvas = element.querySelector('#flint-workbench-preview canvas');
        if (canvas) {
          const { x, y, width, height } = canvas.getBoundingClientRect();
          samples.push({ x, y, width, height });
        }
        await new Promise((resolve) => window.setTimeout(resolve, 25));
      }
      return samples;
    }),
    studio.getByTestId('flint-workbench-apply-draft').click(),
  ]);
  expect(transitionBounds.length).toBeGreaterThan(0);
  for (const bounds of transitionBounds) {
    expect(bounds).toEqual(beforeNotice);
  }
  const pane = studio.getByRole('region', { name: 'Live preview' });
  const message = pane.getByText('Applied the changes to Panel options. Dashboard changes still require Save.', {
    exact: true,
  });
  await expect(message).toBeVisible();
  const chart = pane.locator('canvas').first();
  await expect.poll(async () => chart.boundingBox()).toEqual(beforeNotice);
  const withNotice = await chart.boundingBox();
  await expect(message).toHaveCount(0, { timeout: 5500 });
  await expect.poll(async () => chart.boundingBox()).toEqual(withNotice);
  await expect
    .poll(
      async () =>
        pane.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const preview = element.querySelector('#flint-workbench-preview')!.getBoundingClientRect();
          const canvas = element.querySelector('canvas')!.getBoundingClientRect();
          const tabs = element.querySelector('[role="tablist"]')!.getBoundingClientRect();
          return (
            preview.top - tabs.bottom < 200 && preview.bottom <= bounds.bottom + 1 && canvas.bottom <= bounds.bottom + 1
          );
        }),
      { timeout: 1500 }
    )
    .toBe(true);
});
