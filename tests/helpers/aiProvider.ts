import type { Page } from '@playwright/test';
import Ajv from 'ajv';
import schema from '../../docs/contracts/ai-request-v1.schema.json';
const validateRequest = new Ajv({ allErrors: true }).compile(schema);

export type ProviderMethod = 'chat' | 'generate' | 'repair' | 'plan';
export type ProviderHandler = (input: Record<string, unknown>) => unknown | Promise<unknown>;

/** Only the separately shipped datasource is mocked; the Panel and Flint stay real. */
export async function mockExternalAiProvider(page: Page) {
  const uid = 'flint-browser-provider';
  const name = 'Browser fixture provider';
  const pluginId = 'ibumblebee-flintai-datasource';
  const handlers: Record<ProviderMethod, ProviderHandler> = {
    plan: (input) => {
      const messages = input.messages as Array<{ role: string; content: string }>;
      return {
        mode: 'create',
        summary: [...messages].reverse().find((message) => message.role === 'user')?.content ?? 'Create a chart',
        question: '',
      };
    },
    chat: () => ({ message: 'I will prepare that proposal for your review.' }),
    generate: () => {
      throw new Error('Configure the external generate fixture before sending a request.');
    },
    repair: () => {
      throw new Error('Configure the external repair fixture before sending a request.');
    },
  };

  await page.addInitScript(
    ({ uid, name, pluginId }) => {
      let bootData: Record<string, any>;
      Object.defineProperty(window, 'grafanaBootData', {
        configurable: true,
        get: () => bootData,
        set: (value) => {
          const datasources = value.settings.datasources;
          // This suite must also work when the independent AI plugin is absent.
          for (const [key, datasource] of Object.entries(datasources) as Array<[string, any]>) {
            if (datasource.type === pluginId) {
              delete datasources[key];
            }
          }
          datasources[name] = {
            uid,
            name,
            type: pluginId,
            access: 'proxy',
            isDefault: false,
            jsonData: { model: name },
            meta: {
              id: pluginId,
              name,
              type: 'datasource',
              backend: true,
              module: `public/plugins/${pluginId}/module.js`,
              baseUrl: `public/plugins/${pluginId}`,
              loadingStrategy: 'script',
              signature: 'unsigned',
              info: { logos: {}, author: { name: 'Test fixture' }, links: [] },
              dependencies: { grafanaVersion: '*', plugins: [] },
            },
          };
          bootData = value;
        },
      });
    },
    { uid, name, pluginId }
  );

  await page.route(`**/public/plugins/${pluginId}/module.js*`, async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `define(['@grafana/data'], function (grafana) {
        class FixtureDataSource extends grafana.DataSourceApi {
          async resource(method, input, signal) {
            const response = await fetch('/api/datasources/uid/' + this.uid + '/resources/' + method, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(input), signal: signal
            });
            if (!response.ok) throw Object.assign(new Error(await response.text()), { status: response.status });
            return response.json();
          }
          generate(input, signal) { return this.resource('generate', input, signal); }
          repair(input, signal) { return this.resource('repair', input, signal); }
          chat(input, signal) { return this.resource('chat', input, signal); }
          plan(input, signal) { return this.resource('plan', input, signal); }
        }
        return { plugin: new grafana.DataSourcePlugin(FixtureDataSource) };
      });`,
    });
  });

  for (const method of ['chat', 'generate', 'repair', 'plan'] as const) {
    await page.route(`**/api/datasources/uid/${uid}/resources/${method}`, async (route) => {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      if ((method === 'generate' || method === 'repair') && !validateRequest(input)) {
        await route.fulfill({ status: 400, body: JSON.stringify(validateRequest.errors) });
        return;
      }
      const response = await handlers[method](input);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
    });
  }

  return {
    uid,
    name,
    respond(method: ProviderMethod, handler: ProviderHandler) {
      handlers[method] = handler;
    },
  };
}
