import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';

test('previews, saves and reloads official themes, retaining them on unsupported backends', async ({
  page,
  request,
  readProvisionedDashboard,
  gotoPanelEditPage,
}) => {
  test.setTimeout(90_000);
  const provisioned = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const original = (await (await request.get('/api/dashboards/uid/' + provisioned.uid)).json()).dashboard;
  const seed = original.panels.find((panel: { id: number }) => panel.id === 1);
  const uid = 'flint-theme-' + randomUUID().replaceAll('-', '').slice(0, 20);
  const title = 'Flint theme test ' + uid;
  const created = await request.post('/api/dashboards/db', {
    data: {
      dashboard: {
        ...original,
        id: null,
        uid,
        title,
        version: 0,
        panels: [
          {
            ...seed,
            options: {
              stateVersion: 1,
              renderBackend: 'echarts',
              bindingMode: 'explicit',
              flintInput: { chart_spec: { chartType: 'Bar Chart', encodings: { x: 'Label', y: 'Value' } } },
              ai: { lastPrompt: '' },
            },
          },
        ],
      },
      overwrite: false,
    },
  });
  expect(created.ok()).toBe(true);
  try {
    const edit = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const openSettings = async () => {
      await edit.getCustomOptions('Chart settings').expand();
      await page.getByRole('button', { name: 'Open Chart workbench' }).click();
      const studio = page.getByTestId('flint-ai-studio');
      await studio.getByRole('tab', { name: 'Chart Settings' }).click();
      return studio;
    };
    let studio = await openSettings();
    const preset = () => studio.getByRole('combobox', { name: 'Theme preset' });
    const backend = () => studio.getByRole('combobox', { name: 'Renderer' });
    const apply = async () => {
      await expect(page.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
      await page.getByTestId('flint-workbench-apply-draft').click();
      await studio.getByRole('tab', { name: 'Chart Settings' }).click();
    };
    await expect(preset()).toBeDisabled();
    await expect(studio.getByRole('tabpanel', { name: 'Chart Settings' }).getByRole('status')).toContainText(
      'supported only by Vega-Lite'
    );
    await backend().click();
    await page.getByRole('option', { name: /Vega-Lite/ }).click();
    await expect(preset()).toBeEnabled();
    await preset().click();
    await page.getByRole('option', { name: /The Economist/ }).click();
    await apply();
    await expect(preset()).toHaveValue('The Economist');
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
          (await (await request.get('/api/dashboards/uid/' + uid)).json()).dashboard.panels[0].options.flintInput
            .theme_spec
      )
      .toBe('economist');
    await edit.goto();
    await page.reload();
    studio = await openSettings();
    await expect(preset()).toHaveValue('The Economist');
    for (const choice of [
      { label: /Apache ECharts/, value: 'echarts' },
      { label: /Chart\.js/, value: 'chartjs' },
      { label: /Plotly/, value: 'plotly' },
    ]) {
      await backend().click();
      await page.getByRole('option', { name: choice.label }).click();
      await expect(preset()).toBeDisabled();
      await expect(preset()).toHaveValue('The Economist');
      await expect(studio.getByRole('tabpanel', { name: 'Chart Settings' }).getByRole('status')).toContainText(
        'selected theme is retained'
      );
      await apply();
      await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-render-backend', choice.value);
    }
    await backend().click();
    await page.getByRole('option', { name: /Vega-Lite/ }).click();
    await expect(preset()).toBeEnabled();
    await expect(preset()).toHaveValue('The Economist');
    await preset().click();
    await page.getByRole('option', { name: /Default \(Flint\)/ }).click();
    await apply();
    await expect(preset()).toHaveValue('Default (Flint)');
    await studio.getByRole('tab', { name: 'Flint Spec', exact: true }).click();
    await expect(studio.getByRole('tabpanel', { name: 'Flint Spec' })).not.toContainText('theme_spec');
  } finally {
    const owned = (await (await request.get('/api/dashboards/uid/' + uid)).json()).dashboard;
    expect(owned.title).toBe(title);
    expect((await request.delete('/api/dashboards/uid/' + uid)).ok()).toBe(true);
  }
});
