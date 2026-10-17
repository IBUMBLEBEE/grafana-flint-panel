import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures';
import { mockExternalAiProvider } from './helpers/aiProvider';

test('chat restores an exact Auto chart after Apply and reload, only after reviewed confirmation', async ({
  page,
  request,
  readProvisionedDashboard,
  gotoPanelEditPage,
}) => {
  test.setTimeout(90_000);
  const provider = await mockExternalAiProvider(page);
  let generations = 0;
  provider.respond('plan', (input) => {
    const latest = input.messages.at(-1).content;
    if (latest.includes('回滚')) {
      const revisions = input.panelContext.chartHistory.revisions;
      expect(revisions).toHaveLength(1);
      expect(revisions[0].label).toBe('Grouped Bar Chart');
      return {
        mode: 'restore',
        summary: '准备恢复 Apply 前的分组柱状图，保留原有 Auto 绑定和配色。',
        question: '',
        restoreRevisionId: revisions[0].id,
      };
    }
    return { mode: 'create', summary: 'Switch to Line Chart with quarter and all three measures', question: '' };
  });
  provider.respond('generate', () => {
    generations++;
    return {
      chartType: 'Line Chart',
      chartInput: {
        semantic_types: { quarter: 'Quarter', revenue: 'Amount', expenses: 'Amount', profit: 'Profit' },
        chart_spec: { chartType: 'Line Chart', encodings: { x: 'quarter', y: ['revenue', 'expenses', 'profit'] } },
      },
    };
  });
  const provisioned = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const original = (await (await request.get('/api/dashboards/uid/' + provisioned.uid)).json()).dashboard;
  const seed = original.panels.find((panel: { title: string }) => panel.title.includes('Quarterly Performance'));
  const colors = { revenue: '#0072B2', expenses: '#D55E00', profit: '#009E73' };
  const uid = 'flint-history-' + randomUUID().replaceAll('-', '').slice(0, 20);
  const title = 'Chart history test ' + uid;
  expect(
    (
      await request.post('/api/dashboards/db', {
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
                id: 1,
                options: { ...seed.options, seriesColors: colors, ai: { lastPrompt: '', providerUid: provider.uid } },
              },
            ],
          },
          overwrite: false,
        },
      })
    ).ok()
  ).toBe(true);
  try {
    const edit = await gotoPanelEditPage({ dashboard: { uid }, id: '1' });
    const open = async () => {
      await edit.getCustomOptions('Chart settings').expand();
      await page.getByTestId('flint-ai-open-studio').click();
      return page.getByTestId('flint-ai-studio');
    };
    let studio = await open();
    await studio.getByRole('textbox', { name: 'Message' }).fill('Line Chart');
    await studio.getByRole('button', { name: 'Send message' }).click();
    await expect(studio.getByTestId('flint-ai-chat-thread')).toContainText('I will prepare that proposal');
    await studio.getByTestId('flint-ai-generate').click();
    await expect(studio.getByTestId('flint-ai-apply-draft')).toBeEnabled();
    await studio.getByTestId('flint-ai-apply-draft').click();
    await expect(studio.getByTestId('flint-ai-chat-thread')).toContainText('Applied Line Chart to Panel options');
    await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'Line Chart');
    await page
      .getByRole('dialog', { name: 'Chart workbench' })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    const save = async () => {
      await edit.backToDashboard();
      await page.getByRole('button', { name: /^(Save|Save dashboard)$/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    };
    await save();
    await edit.goto();
    await page.reload();
    studio = await open();
    await expect(studio.getByRole('button', { name: 'Undo last apply' })).toBeEnabled();
    await studio.getByRole('textbox', { name: 'Message' }).fill('我点了apply，你能帮我回滚到 Grouped Bar Chart');
    await studio.getByRole('button', { name: 'Send message' }).click();
    await expect(studio.getByRole('button', { name: 'Restore this version', exact: true })).toBeEnabled();
    await expect(studio.getByTestId('flint-ai-dialog-chart')).toHaveAttribute('data-chart-type', 'Grouped Bar Chart');
    await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'Line Chart');
    expect(generations).toBe(1);
    await studio.getByRole('button', { name: 'Restore this version', exact: true }).click();
    await expect(studio.getByTestId('flint-ai-chat-thread')).toContainText(
      'Restored Grouped Bar Chart to Panel options'
    );
    await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'Grouped Bar Chart');
    const downloaded = page.waitForEvent('download');
    await studio.getByRole('button', { name: 'Export diagnostics' }).click();
    const file = await downloaded;
    const report = JSON.parse(await readFile((await file.path())!, 'utf8'));
    expect(report.history.revisions.map((revision: { action: string }) => revision.action)).toEqual([
      'initial',
      'applied',
      'restored',
    ]);
    expect(report.chart.committed.flintInput).toEqual(seed.options.flintInput);
    expect(report.chart.committed.bindingMode).toBe('auto');
    expect(report.chart.committed.seriesColors).toEqual(colors);
    await studio.getByRole('button', { name: 'Undo last apply' }).click();
    await expect(studio.getByRole('button', { name: 'Restore this version', exact: true })).toBeEnabled();
    await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'Grouped Bar Chart');
    await studio.getByTestId('flint-ai-discard-draft').click();
    await page
      .getByRole('dialog', { name: 'Chart workbench' })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await save();
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/dashboards/uid/' + uid)).json()).dashboard.panels[0].options.flintInput
      )
      .toEqual(seed.options.flintInput);
    const saved = (await (await request.get('/api/dashboards/uid/' + uid)).json()).dashboard.panels[0].options;
    expect(saved.flintInput).toEqual(seed.options.flintInput);
    expect(saved.bindingMode).toBe('auto');
    expect(saved.seriesColors).toEqual(colors);
    expect(saved).not.toHaveProperty('restoreRevisionId');
    expect(generations).toBe(1);
  } finally {
    const owned = (await (await request.get('/api/dashboards/uid/' + uid)).json()).dashboard;
    expect(owned.title).toBe(title);
    expect((await request.delete('/api/dashboards/uid/' + uid)).ok()).toBe(true);
  }
});
