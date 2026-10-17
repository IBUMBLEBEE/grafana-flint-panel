import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { PanelEditPage } from '@grafana/plugin-e2e';

import { expect, test as base } from './fixtures';
import { mockExternalAiProvider } from './helpers/aiProvider';

const authoredInput = {
  semantic_types: { Label: 'Category', Value: 'Amount' },
  field_display_names: { Value: 'Revenue' },
  chart_spec: {
    chartType: 'Bar Chart',
    title: 'Revenue by category',
    subtitle: 'Current query values',
    encodings: { x: { field: 'Label' }, y: { field: 'Value' } },
    chartProperties: { cornerRadius: 4 },
  },
};

interface AiFixtures {
  provider: Awaited<ReturnType<typeof mockExternalAiProvider>>;
  aiEdit: { edit: PanelEditPage; uid: string };
  initialInput: typeof authoredInput | undefined;
}

const test = base.extend<AiFixtures>({
  initialInput: [undefined, { option: true }],
  provider: async ({ page }, use) => {
    await use(await mockExternalAiProvider(page));
  },
  aiEdit: async ({ provider, initialInput, readProvisionedDashboard, request, gotoPanelEditPage }, use) => {
    const provisioned = await readProvisionedDashboard({ fileName: 'dashboard.json' });
    const source = await request.get('/api/dashboards/uid/' + provisioned.uid);
    expect(source.ok()).toBe(true);
    const original = (await source.json()).dashboard;
    const seed = original.panels.find((panel: { id: number }) => panel.id === 1);
    const uid = 'flint-ai-' + randomUUID().replaceAll('-', '').slice(0, 24);
    const title = 'Flint AI browser test ' + uid;
    const response = await request.post('/api/dashboards/db', {
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
                bindingMode: initialInput ? 'explicit' : 'auto',
                flintInput: initialInput ?? { chart_spec: { chartType: 'auto', encodings: {} } },
                ai: { lastPrompt: '', providerUid: provider.uid },
              },
            },
          ],
        },
        overwrite: false,
      },
    });
    expect(response.ok()).toBe(true);
    try {
      await use({ edit: await gotoPanelEditPage({ dashboard: { uid }, id: '1' }), uid });
    } finally {
      const owned = (await (await request.get('/api/dashboards/uid/' + uid)).json()).dashboard;
      expect(owned.uid).toBe(uid);
      expect(owned.title).toBe(title);
      expect((await request.delete('/api/dashboards/uid/' + uid)).ok()).toBe(true);
    }
  },
});

test('downloads diagnostics for a failed generation and a reviewable proposal', async ({
  aiEdit,
  provider,
  page,
  request,
}) => {
  await aiEdit.edit.getCustomOptions('Chart settings').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  await studio.getByRole('textbox', { name: 'Message' }).fill('Generate a bar chart');
  await studio.getByRole('button', { name: 'Send message' }).click();
  await expect(studio.getByTestId('flint-ai-chat-thread')).toContainText('I will prepare that proposal');
  provider.respond('generate', () => ({ chartType: 'Magic Chart' }));
  provider.respond('repair', () => ({ chartType: 'Magic Chart' }));
  await studio.getByTestId('flint-ai-generate').click();
  await expect(studio.getByRole('alert', { name: 'AI Assist error' })).toBeVisible();
  const downloadReport = async () => {
    const downloaded = page.waitForEvent('download', { timeout: 5000 });
    await studio.getByRole('button', { name: 'Export diagnostics' }).click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toMatch(/^flint-ai-diagnostics-.*\.json$/);
    const path = await file.path();
    expect(path).not.toBeNull();
    return JSON.parse(await readFile(path!, 'utf8'));
  };
  const failed = await downloadReport();
  expect(failed).toMatchObject({
    format: 'flint-ai-diagnostics',
    version: 2,
    provider: { uid: provider.uid },
    panelContext: { dashboardUid: aiEdit.uid },
    status: { error: expect.stringContaining('Unsupported chartType'), canApply: false },
  });
  expect(failed.conversation).toEqual(
    expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Generate a bar chart' })])
  );
  expect(failed.requests).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ operation: 'chat', status: 'success' }),
      expect.objectContaining({ operation: 'plan', status: 'success' }),
      expect.objectContaining({ operation: 'generate', response: { chartType: 'Magic Chart' } }),
    ])
  );
  expect(failed.frames[0].fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Value' })]));
  expect(failed.frames[0].fields[0]).not.toHaveProperty('values');
  provider.respond('generate', () => ({ chartInput: authoredInput }));
  await studio.getByTestId('flint-ai-generate').click();
  await expect(studio.getByTestId('flint-ai-apply-draft')).toBeEnabled();
  const ready = await downloadReport();
  expect(ready.chart.draft.flintInput).toEqual(authoredInput);
  expect(ready.status.canApply).toBe(true);
  expect(ready.status).not.toHaveProperty('error');
  expect(ready.proposalPlan.mode).toBe('create');
  const saved = (await (await request.get('/api/dashboards/uid/' + aiEdit.uid)).json()).dashboard;
  expect(saved.panels[0].options.flintInput.chart_spec.chartType).toBe('auto');
});

test('contract rejection preserves manual settings and never applies the failed AI proposal', async ({
  aiEdit,
  provider,
  page,
  request,
}) => {
  await aiEdit.edit.getCustomOptions('Chart settings').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  await studio.getByRole('tab', { name: 'Chart Settings', exact: true }).click();
  await studio.getByRole('combobox', { name: 'Tooltip', exact: true }).click();
  await page.getByRole('option', { name: 'Off', exact: true }).click();
  await expect(studio.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
  await studio.getByRole('textbox', { name: 'Message' }).fill('Create a bar chart');
  await studio.getByRole('button', { name: 'Send message' }).click();
  await expect(studio.getByTestId('flint-ai-chat-thread')).toContainText('I will prepare');
  await page.route(`**/api/datasources/uid/${provider.uid}/resources/generate`, (route) =>
    route.fulfill({ status: 400, body: 'invalid generate request' })
  );
  await studio.getByTestId('flint-ai-generate').click();
  await expect(studio.getByRole('alert', { name: 'AI Assist error' })).toContainText('request contract');
  await expect(studio.getByTestId('flint-ai-apply-draft')).toHaveCount(0);
  await expect(studio.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
  await expect(studio.getByRole('combobox', { name: 'Tooltip', exact: true })).toHaveValue('Off');
  const saved = (await (await request.get('/api/dashboards/uid/' + aiEdit.uid)).json()).dashboard;
  expect(saved.panels[0].options.flintInput.chart_spec.chartType).toBe('auto');
  expect(saved.panels[0].options.flintInput).not.toHaveProperty('options.addTooltips');
  const downloaded = page.waitForEvent('download');
  await studio.getByRole('button', { name: 'Export diagnostics' }).click();
  const file = await downloaded;
  const report = JSON.parse(await readFile((await file.path())!, 'utf8'));
  const failed = report.requests.find((entry: { operation: string }) => entry.operation === 'generate');
  expect(failed).toMatchObject({
    requestStage: 'datasource-call',
    contractVersion: 1,
    httpStatus: 400,
    status: 'error',
  });
  expect(failed.request).toHaveProperty('generationMode');
  expect(failed.transmittedRequest).not.toHaveProperty('generationMode');
});

test('does not regenerate a chart when rollback history is unavailable, even if AI misclassifies it', async ({
  aiEdit,
  provider,
  page,
}) => {
  let generations = 0;
  provider.respond('plan', () => ({ mode: 'create', summary: 'Create another bar chart', question: '' }));
  provider.respond('generate', () => {
    generations++;
    return { chartInput: authoredInput };
  });
  await aiEdit.edit.getCustomOptions('Chart settings').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  await studio.getByRole('textbox', { name: 'Message' }).fill('撤销刚才的修改');
  await studio.getByRole('button', { name: 'Send message' }).click();
  await expect(studio.getByTestId('flint-ai-chat-thread')).toContainText('No earlier chart version');
  await studio.getByTestId('flint-ai-generate').click();
  await expect(studio.getByRole('alert', { name: 'AI Assist error' })).toContainText('No earlier chart version');
  expect(generations).toBe(0);
  await expect(studio.getByTestId('flint-ai-apply-draft')).toHaveCount(0);
  await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'auto');
});

test.describe('bounded AI refinements', () => {
  test.use({ initialInput: authoredInput });

  test('asks for clarification before generating an ambiguous change, then uses the answer', async ({
    aiEdit,
    provider,
    page,
    request,
  }) => {
    let plans = 0;
    let generations = 0;
    provider.respond('plan', (input) => {
      plans++;
      if (plans === 1) {
        return { mode: 'clarify', summary: '', question: '你希望修改标题还是图表结构？' };
      }
      expect(input.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: '优化一下' }),
          expect.objectContaining({ role: 'assistant', content: '你希望修改标题还是图表结构？' }),
          expect.objectContaining({ role: 'user', content: '只把标题改成季度营收' }),
        ])
      );
      return { mode: 'refine', summary: '只把当前图表标题改成季度营收，保留所有字段绑定。', question: '' };
    });
    provider.respond('generate', () => {
      generations++;
      return { chartInput: { ...authoredInput, chart_spec: { ...authoredInput.chart_spec, title: '季度营收' } } };
    });
    await aiEdit.edit.getCustomOptions('Chart settings').expand();
    await page.getByTestId('flint-ai-open-studio').click();
    const studio = page.getByTestId('flint-ai-studio');
    await studio.getByRole('textbox', { name: 'Message' }).fill('优化一下');
    await studio.getByRole('button', { name: 'Send message' }).click();
    await expect(studio.getByTestId('flint-ai-chat-thread')).toContainText('I will prepare that proposal');
    await studio.getByTestId('flint-ai-generate').click();
    await expect(studio.getByTestId('flint-ai-chat-thread')).toContainText('你希望修改标题还是图表结构？');
    expect(generations).toBe(0);
    await expect(studio.getByTestId('flint-ai-apply-draft')).toHaveCount(0);
    await studio.getByRole('textbox', { name: 'Message' }).fill('只把标题改成季度营收');
    await studio.getByRole('button', { name: 'Send message' }).click();
    await expect(studio.getByTestId('flint-ai-generate')).toBeEnabled();
    await studio.getByTestId('flint-ai-generate').click();
    await expect(studio.getByTestId('flint-ai-apply-draft')).toBeEnabled();
    await expect(studio.getByTestId('flint-ai-proposal-scope')).toContainText('Adjust current chart');
    expect(generations).toBe(1);
    const saved = (await (await request.get('/api/dashboards/uid/' + aiEdit.uid)).json()).dashboard;
    expect(saved.panels[0].options.flintInput).toEqual(authoredInput);
  });

  test('refines chart text while preserving committed bindings, semantics and properties', async ({
    aiEdit,
    provider,
    page,
    request,
  }) => {
    provider.respond('plan', () => ({
      mode: 'refine',
      summary: 'Change only the headline and display text',
      question: '',
    }));
    const refined = {
      ...authoredInput,
      field_display_names: { Value: 'Current revenue' },
      chart_spec: { ...authoredInput.chart_spec, title: 'Refined revenue finding', subtitle: 'Text-only revision' },
    };
    let requestContext: Record<string, unknown> | undefined;
    provider.respond('generate', (input) => {
      requestContext = input;
      return { chartInput: refined, rationale: 'Update only chart text.' };
    });
    await aiEdit.edit.getCustomOptions('Chart settings').expand();
    await page.getByTestId('flint-ai-open-studio').click();
    const studio = page.getByTestId('flint-ai-studio');
    await expect(studio.getByRole('combobox', { name: 'AI proposal mode' })).toHaveCount(0);
    await studio.getByRole('textbox', { name: 'Message' }).fill('Change only the headline and display text');
    await studio.getByRole('button', { name: 'Send message' }).click();
    await expect(studio.getByTestId('flint-ai-chat-thread')).toContainText('I will prepare that proposal');
    await studio.getByTestId('flint-ai-generate').click();
    await expect(studio.getByTestId('flint-ai-apply-draft')).toBeEnabled();
    await expect(studio.getByTestId('flint-ai-dialog-chart').locator('canvas').first()).toBeVisible();
    await studio.getByRole('tab', { name: 'Flint Spec' }).click();
    await expect(studio.getByRole('tabpanel', { name: 'Flint Spec' })).toContainText('Refined revenue finding');
    const beforeApply = (await (await request.get('/api/dashboards/uid/' + aiEdit.uid)).json()).dashboard;
    expect(beforeApply.panels[0].options.flintInput).toEqual(authoredInput);
    expect(requestContext?.prompt).toContain('Refine the current Flint source');
    expect(JSON.parse(String(requestContext?.prompt).split('Current Flint source:\n')[1].split('\n')[0])).toEqual(
      authoredInput
    );
    expect(requestContext).not.toHaveProperty('generationMode');
    expect(requestContext).not.toHaveProperty('currentChartState');
    expect(requestContext).not.toHaveProperty('allowedPaths');
    await studio.getByTestId('flint-ai-apply-draft').click();
    await expect(studio.getByTestId('flint-ai-apply-draft')).toHaveCount(0);
    await page
      .getByRole('dialog', { name: 'Chart workbench' })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await aiEdit.edit.backToDashboard();
    await page.getByRole('button', { name: /^(Save|Save dashboard)$/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(async () => {
        const saved = (await (await request.get('/api/dashboards/uid/' + aiEdit.uid)).json()).dashboard;
        return saved.panels[0].options.flintInput;
      })
      .toEqual(refined);
    await aiEdit.edit.goto();
    await aiEdit.edit.getCustomOptions('Chart settings').expand();
    await page.getByTestId('flint-ai-open-studio').click();
    await studio.getByRole('tab', { name: 'Flint Spec' }).click();
    await expect(studio.getByRole('tabpanel', { name: 'Flint Spec' })).toContainText('Refined revenue finding');
    await expect(studio.getByRole('tabpanel', { name: 'Flint Spec' })).toContainText('Amount');
  });

  test('rejects an unauthorized refinement even when a repair tries to remove locked semantics', async ({
    aiEdit,
    provider,
    page,
    request,
  }) => {
    let repairContext: Record<string, unknown> | undefined;
    provider.respond('plan', () => ({ mode: 'refine', summary: 'Rename only the title', question: '' }));
    provider.respond('generate', () => ({
      chartInput: {
        ...authoredInput,
        chart_spec: {
          ...authoredInput.chart_spec,
          title: 'Unauthorized field change',
          encodings: { x: { field: 'Time' }, y: { field: 'Value' } },
        },
      },
      // Legacy scalar fields must never turn a failed refinement into a replacement.
      chartType: 'Bar Chart',
      xField: 'Label',
      yField: 'Value',
    }));
    provider.respond('repair', (input) => {
      repairContext = input;
      return {
        chartInput: {
          field_display_names: authoredInput.field_display_names,
          chart_spec: { ...authoredInput.chart_spec, title: 'Unauthorized semantic deletion' },
        },
        chartType: 'Bar Chart',
        xField: 'Label',
        yField: 'Value',
      };
    });
    await aiEdit.edit.getCustomOptions('Chart settings').expand();
    await page.getByTestId('flint-ai-open-studio').click();
    const studio = page.getByTestId('flint-ai-studio');
    await studio.getByRole('textbox', { name: 'Message' }).fill('Rename only the title');
    await studio.getByRole('button', { name: 'Send message' }).click();
    await expect(studio.getByTestId('flint-ai-chat-thread')).toContainText('I will prepare that proposal');
    await studio.getByTestId('flint-ai-generate').click();
    await expect(studio.getByRole('alert', { name: 'AI Assist error' })).toContainText(
      'Refinement cannot change locked Flint source path'
    );
    await expect(studio.getByTestId('flint-ai-apply-draft')).toHaveCount(0);
    await expect(studio.getByTestId('flint-ai-proposal')).toHaveCount(0);
    await studio.getByRole('tab', { name: 'Flint Spec' }).click();
    await expect(studio.getByRole('tabpanel', { name: 'Flint Spec' })).toContainText('Revenue by category');
    await expect(studio.getByRole('tabpanel', { name: 'Flint Spec' })).not.toContainText('Unauthorized');
    const repairRequest = repairContext?.request as { prompt: string };
    expect(JSON.parse(repairRequest.prompt.split('Current Flint source:\n')[1].split('\n')[0])).toEqual(authoredInput);
    expect(repairContext?.request).not.toHaveProperty('generationMode');
    expect(repairContext?.request).not.toHaveProperty('currentChartState');
    expect(repairContext?.request).not.toHaveProperty('allowedPaths');
    const saved = (await (await request.get('/api/dashboards/uid/' + aiEdit.uid)).json()).dashboard;
    expect(saved.panels[0].options.flintInput).toEqual(authoredInput);
  });
});

test('previews and explicitly saves a structured-only AI source without losing its semantics', async ({
  aiEdit,
  provider,
  page,
  request,
}) => {
  test.setTimeout(60_000);
  provider.respond('generate', () => ({ chartInput: authoredInput, rationale: 'Compare the current categories.' }));
  await aiEdit.edit.getCustomOptions('Chart settings').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  await studio.getByRole('textbox', { name: 'Message' }).fill('Show revenue by category with rounded bars');
  await studio.getByRole('button', { name: 'Send message' }).click();
  await expect(studio.getByTestId('flint-ai-chat-thread')).toContainText('I will prepare that proposal');
  await studio.getByTestId('flint-ai-generate').click();
  await expect(studio.getByTestId('flint-ai-dialog-chart')).toHaveAttribute('data-chart-type', 'Bar Chart');
  await expect(studio.getByTestId('flint-ai-dialog-chart').locator('canvas').first()).toBeVisible();
  await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'auto');
  await studio.getByRole('tab', { name: 'Flint Spec' }).click();
  await expect(studio.getByRole('tabpanel', { name: 'Flint Spec' })).toContainText('Revenue by category');
  await expect(studio.getByTestId('flint-ai-apply-draft')).toBeEnabled();
  await studio.getByTestId('flint-ai-apply-draft').click();
  await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'Bar Chart');
  await page
    .getByRole('dialog', { name: 'Chart workbench' })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await aiEdit.edit.backToDashboard();
  await page.getByRole('button', { name: /^(Save|Save dashboard)$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => {
      const saved = (await (await request.get('/api/dashboards/uid/' + aiEdit.uid)).json()).dashboard;
      return saved.panels[0].options.flintInput;
    })
    .toEqual(authoredInput);
  const options = (await (await request.get('/api/dashboards/uid/' + aiEdit.uid)).json()).dashboard.panels[0].options;
  expect(options).toMatchObject({ stateVersion: 1, renderBackend: 'echarts', bindingMode: 'explicit' });
  for (const key of ['chartType', 'xField', 'yField', 'colorField', 'specJson', 'frameworkOverrides']) {
    expect(options).not.toHaveProperty(key);
  }
  expect(options.flintInput).not.toHaveProperty('data');
  expect(options.flintInput.chart_spec).not.toHaveProperty('canvasSize');
  expect(options.ai).not.toHaveProperty('draft');
  expect(options.ai).not.toHaveProperty('pending');
  await aiEdit.edit.goto();
  await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'Bar Chart');
  await expect(page.getByTestId('flint-panel-chart').locator('canvas').first()).toBeVisible();
});

test('clearly reports a valid legacy scalar fallback when advanced input and repair are invalid', async ({
  aiEdit,
  provider,
  page,
}) => {
  const legacyResponse = {
    chartType: 'bar',
    xField: 'Label',
    yField: 'Value',
    chartInput: { mark: 'bar', encoding: { x: { field: 'Label' }, y: { field: 'Value' } } },
    rationale: 'Legacy provider comparison proposal.',
  };
  provider.respond('generate', () => legacyResponse);
  provider.respond('repair', () => legacyResponse);
  await aiEdit.edit.getCustomOptions('Chart settings').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  await studio.getByRole('textbox', { name: 'Message' }).fill('Create a new bar chart');
  await studio.getByRole('button', { name: 'Send message' }).click();
  await expect(studio.getByTestId('flint-ai-chat-thread')).toContainText('I will prepare that proposal');
  await studio.getByTestId('flint-ai-generate').click();
  await expect(studio.getByTestId('flint-ai-chat-thread')).toContainText(
    'Advanced Flint input was rejected after repair'
  );
  await expect(studio.getByTestId('flint-ai-dialog-chart')).toHaveAttribute('data-chart-type', 'Bar Chart');
  await expect(studio.getByTestId('flint-ai-dialog-chart').locator('canvas').first()).toBeVisible();
  await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'auto');
  await expect(studio.getByTestId('flint-ai-apply-draft')).toBeEnabled();
  await studio.getByTestId('flint-ai-apply-draft').click();
  await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'Bar Chart');
  await studio.getByRole('tab', { name: 'Flint Spec' }).click();
  await expect(studio.getByRole('tabpanel', { name: 'Flint Spec' })).toContainText('Label');
  await expect(studio.getByRole('tabpanel', { name: 'Flint Spec' })).not.toContainText('"mark"');
});

test('ignores an AI response that arrives after a manual chart change was applied', async ({
  aiEdit,
  provider,
  page,
}) => {
  let releaseResponse!: (value: unknown) => void;
  const delayedResponse = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  provider.respond('generate', () => delayedResponse);
  const response = { chartInput: authoredInput, rationale: 'This is the old request result.' };
  try {
    await aiEdit.edit.getCustomOptions('Chart settings').expand();
    await page.getByTestId('flint-ai-open-studio').click();
    const studio = page.getByTestId('flint-ai-studio');
    await studio.getByRole('textbox', { name: 'Message' }).fill('Generate a bar chart');
    await studio.getByRole('button', { name: 'Send message' }).click();
    await expect(studio.getByTestId('flint-ai-chat-thread')).toContainText('I will prepare that proposal');
    const started = page.waitForRequest(`**/api/datasources/uid/${provider.uid}/resources/generate`);
    await studio.getByTestId('flint-ai-generate').click();
    await started;
    await expect(studio.getByRole('button', { name: 'Cancel generation' })).toBeVisible();
    await studio.getByRole('tab', { name: 'Chart Settings' }).click();
    await studio.getByRole('combobox', { name: 'Chart type' }).click();
    await page.getByRole('option', { name: 'Pie Chart', exact: true }).click();
    await expect(studio.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
    await studio.getByTestId('flint-workbench-apply-draft').click();
    await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'Pie Chart');
    releaseResponse(response);
    await expect(studio.getByRole('alert', { name: 'AI Assist error' })).toContainText(
      'chart source or Panel query changed during generation'
    );
    await expect(studio.getByTestId('flint-ai-apply-draft')).toHaveCount(0);
    await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'Pie Chart');
    await studio.getByRole('tab', { name: 'Flint Spec' }).click();
    await expect(studio.getByRole('tabpanel', { name: 'Flint Spec' })).toContainText('Pie Chart');
    await expect(studio.getByRole('tabpanel', { name: 'Flint Spec' })).not.toContainText('Revenue by category');
  } finally {
    releaseResponse(response);
  }
});

test('AI structural changes preserve uncommitted manual settings', async ({ aiEdit, provider, page }) => {
  provider.respond('generate', (input) => {
    const current = JSON.parse(input.prompt.split('Current Flint source:\n')[1]);
    expect(current.options.addTooltips).toBe(false);
    expect(current.chart_spec.chartProperties.cornerRadius).toBe(8);
    return {
      chartInput: {
        chart_spec: {
          chartType: 'Line Chart',
          encodings: { x: 'Label', y: 'Value' },
          chartProperties: { showPoints: true },
        },
      },
    };
  });
  await aiEdit.edit.getCustomOptions('Chart settings').expand();
  await page.getByTestId('flint-ai-open-studio').click();
  const studio = page.getByTestId('flint-ai-studio');
  await studio.getByRole('tab', { name: 'Chart Settings' }).click();
  const settings = studio.getByRole('tabpanel', { name: 'Chart Settings' });
  await settings.getByRole('combobox', { name: 'Chart type' }).click();
  await page.getByRole('option', { name: 'Bar Chart', exact: true }).click();
  await settings.getByRole('spinbutton', { name: 'Corners', exact: true }).fill('8');
  await settings.getByRole('spinbutton', { name: 'Corners', exact: true }).press('Tab');
  await settings.getByRole('combobox', { name: 'Tooltip', exact: true }).click();
  await page.getByRole('option', { name: 'Off', exact: true }).click();
  await studio.getByRole('textbox', { name: 'Message' }).fill('Change to a line chart');
  await studio.getByRole('button', { name: 'Send message' }).click();
  await expect(studio.getByTestId('flint-ai-chat-thread')).toContainText('I will prepare that proposal');
  await studio.getByTestId('flint-ai-generate').click();
  await expect(studio.getByTestId('flint-ai-apply-draft')).toBeEnabled();
  await studio.getByTestId('flint-ai-apply-draft').click();
  await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-chart-type', 'Line Chart');
  await studio.getByRole('tab', { name: 'Chart Settings' }).click();
  await expect(settings.getByRole('combobox', { name: 'Tooltip', exact: true })).toHaveValue('Off');
  await expect(settings.getByRole('combobox', { name: 'Points', exact: true })).toHaveValue('On');
});

test('manual Apply shows a workbench notice without adding AI messages, while AI Apply confirms once in chat', async ({
  aiEdit,
  provider,
  page,
}) => {
  provider.respond('generate', () => ({ chartInput: authoredInput }));
  await aiEdit.edit.getCustomOptions('Chart settings').expand();
  await page.getByRole('button', { name: 'Open Chart workbench' }).click();
  const studio = page.getByTestId('flint-ai-studio');
  const thread = studio.getByTestId('flint-ai-chat-thread');
  const initialConversation = (await thread.textContent()) ?? '';
  await studio.getByRole('tab', { name: 'Chart Settings' }).click();
  const settings = studio.getByRole('tabpanel', { name: 'Chart Settings' });
  await settings.getByRole('combobox', { name: 'Tooltip', exact: true }).click();
  await page.getByRole('option', { name: 'Off', exact: true }).click();
  await expect(studio.getByTestId('flint-workbench-apply-draft')).toBeEnabled();
  await studio.getByTestId('flint-workbench-apply-draft').click();
  const workbench = studio.getByRole('region', { name: 'Live preview' });
  await expect(workbench).toContainText('Applied the changes to Panel options. Dashboard changes still require Save.');
  await expect(thread).toHaveText(initialConversation);
  await expect(studio.getByRole('button', { name: 'Undo last apply' })).toBeEnabled();
  await expect(
    studio
      .getByRole('region', { name: 'AI chat and proposal controls' })
      .getByText('Applied the proposal to Panel options.', { exact: true })
  ).toHaveCount(0);
  await studio.getByRole('textbox', { name: 'Message' }).fill('Generate a bar chart');
  await studio.getByRole('button', { name: 'Send message' }).click();
  await expect(thread).toContainText('I will prepare that proposal');
  await studio.getByTestId('flint-ai-generate').click();
  await expect(studio.getByTestId('flint-ai-apply-draft')).toBeEnabled();
  await studio.getByTestId('flint-ai-apply-draft').click();
  await expect(
    thread.getByText('Applied Bar Chart to Panel options. Dashboard changes still require Save.', { exact: true })
  ).toHaveCount(1);
});

test('manual preview errors and Discard stay in workbench when AI Chat is hidden and reopened', async ({
  aiEdit,
  page,
}) => {
  await aiEdit.edit.getCustomOptions('Chart settings').expand();
  await page.getByRole('button', { name: 'Open Chart workbench' }).click();
  const studio = page.getByTestId('flint-ai-studio');
  const workbench = studio.getByRole('region', { name: 'Live preview' });
  const chat = studio.getByRole('region', { name: 'AI chat and proposal controls' });
  const thread = studio.getByTestId('flint-ai-chat-thread');
  const originalConversation = (await thread.textContent()) ?? '';
  await page.getByRole('dialog', { name: 'Chart workbench' }).getByRole('button', { name: 'Hide AI Chat' }).click();
  await studio.getByRole('tab', { name: 'Chart Settings' }).click();
  await studio.getByRole('combobox', { name: 'Chart type' }).click();
  await page.getByRole('option', { name: 'Gauge Chart', exact: true }).click();
  await studio.getByRole('combobox', { name: 'Renderer' }).click();
  await page.getByRole('option', { name: /Vega-Lite/ }).click();
  await expect(workbench.getByRole('alert', { name: 'Preview failed' })).toBeVisible();
  await expect(workbench.getByRole('alert', { name: 'Preview failed' })).toContainText('Unsupported chartType');
  await page.getByRole('dialog', { name: 'Chart workbench' }).getByRole('button', { name: 'Show AI Chat' }).click();
  await expect(chat.getByRole('alert', { name: 'Preview failed' })).toHaveCount(0);
  await expect(thread).toHaveText(originalConversation);
  await studio.getByRole('button', { name: 'Discard edits', exact: true }).click();
  await expect(workbench).toContainText('Discarded manual changes.');
  await expect(workbench.getByRole('alert', { name: 'Preview failed' })).toHaveCount(0);
  await expect(chat).not.toContainText('Discarded manual changes.');
  await expect(thread).toHaveText(originalConversation);
  await expect(page.getByTestId('flint-panel-chart')).toHaveAttribute('data-render-backend', 'echarts');
});
