import { randomUUID } from 'node:crypto';

import { expect, test } from './fixtures';
import { mockExternalAiProvider } from './helpers/aiProvider';

test('previews and saves a palette-only refinement of the Auto quarterly chart', async ({
  page,
  request,
  readProvisionedDashboard,
  gotoPanelEditPage,
}, testInfo) => {
  test.setTimeout(90_000);
  const colors = { revenue: '#6C91C2', expenses: '#91A4B5', profit: '#C8AA64' };
  const provider = await mockExternalAiProvider(page);
  provider.respond('plan', (input) => {
    expect(input.panelContext).toMatchObject({
      dataHint: expect.stringContaining('Series color changes supported: true'),
    });
    return {
      mode: 'refine',
      summary: '商务稳重，深色主题，营收蓝色、支出灰蓝色、利润金色。保持分组柱状图。',
      question: '',
    };
  });
  provider.respond('generate', (input) => {
    expect(input).not.toHaveProperty('generationMode');
    expect(input.prompt).toContain('Runtime measure series: ["revenue","expenses","profit"]');
    return {
      chartType: 'Grouped Bar Chart',
      seriesColors: colors,
      chartInput: null,
      rationale: 'Blue, slate and gold; preserve the chart.',
    };
  });
  const provisioned = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const original = (await (await request.get('/api/dashboards/uid/' + provisioned.uid)).json()).dashboard;
  const seed = original.panels.find((panel: { title: string }) => panel.title.includes('Quarterly Performance'));
  expect(seed).toBeDefined();
  const uid = 'flint-colors-' + randomUUID().replaceAll('-', '').slice(0, 20);
  const title = 'Series colors browser test ' + uid;
  const response = await request.post('/api/dashboards/db', {
    data: {
      dashboard: {
        ...original,
        id: null,
        uid,
        title,
        version: 0,
        panels: [{ ...seed, id: 1, options: { ...seed.options, ai: { lastPrompt: '', providerUid: provider.uid } } }],
      },
      overwrite: false,
    },
  });
  expect(response.ok()).toBe(true);
  try {
    const edit = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    await edit.getCustomOptions('Chart settings').expand();
    await page.getByTestId('flint-ai-open-studio').click();
    const studio = page.getByTestId('flint-ai-studio');
    await expect(studio.getByRole('combobox', { name: 'AI proposal mode' })).toHaveCount(0);
    await studio
      .getByRole('textbox', { name: 'Message' })
      .fill('商务稳重，深色主题，营收蓝色、支出灰蓝色、利润金色。保持分组柱状图。');
    await studio.getByRole('button', { name: 'Send message' }).click();
    await expect(studio.getByTestId('flint-ai-chat-thread')).toContainText('I will prepare that proposal');
    await studio.getByTestId('flint-ai-generate').click();
    await expect(studio.getByTestId('flint-ai-apply-draft')).toBeEnabled();
    await expect(studio.getByTestId('flint-ai-proposal-scope')).toContainText('Adjust current chart');
    await studio.screenshot({ path: testInfo.outputPath('automatic-proposal-scope.png') });
    const canvas = studio.getByTestId('flint-ai-dialog-chart').locator('canvas').first();
    await expect(canvas).toBeVisible();
    await expect
      .poll(() =>
        canvas.evaluate((element, colors) => {
          const canvas = element as HTMLCanvasElement;
          const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
          return Object.values(colors).map((color) => {
            const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
            let count = 0;
            for (let i = 0; i < pixels.length; i += 4) {
              if (rgb.every((channel, index) => channel === pixels[i + index])) count++;
            }
            return count > 10;
          });
        }, colors)
      )
      .toEqual([true, true, true]);
    const before = (await (await request.get('/api/dashboards/uid/' + uid)).json()).dashboard.panels[0].options;
    expect(before).not.toHaveProperty('seriesColors');
    await studio.getByTestId('flint-ai-apply-draft').click();
    await expect(studio.getByTestId('flint-ai-apply-draft')).toHaveCount(0);
    await page
      .getByRole('dialog', { name: 'Chart workbench' })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await edit.backToDashboard();
    await page.getByRole('button', { name: /^(Save|Save dashboard)$/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/dashboards/uid/' + uid)).json()).dashboard.panels[0].options.seriesColors
      )
      .toEqual(colors);
    const saved = (await (await request.get('/api/dashboards/uid/' + uid)).json()).dashboard.panels[0].options;
    expect(saved.flintInput).toEqual(seed.options.flintInput);
    expect(saved.bindingMode).toBe('auto');
    await edit.goto();
    await expect(page.getByTestId('flint-panel-chart').locator('canvas').first()).toBeVisible();
  } finally {
    const owned = (await (await request.get('/api/dashboards/uid/' + uid)).json()).dashboard;
    expect(owned.title).toBe(title);
    expect((await request.delete('/api/dashboards/uid/' + uid)).ok()).toBe(true);
  }
});
