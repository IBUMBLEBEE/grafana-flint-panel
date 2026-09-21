import { expect, test as base } from '@grafana/plugin-e2e';

interface FlintTestFixtures {
  assertNoPageErrors: void;
}

/** Makes every plugin E2E fail on an unhandled browser exception. */
export const test = base.extend<FlintTestFixtures>({
  assertNoPageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const record = (error: Error) => errors.push(error.stack ?? error.message);
      page.on('pageerror', record);

      await use();

      page.off('pageerror', record);
      expect(errors, 'Unhandled browser page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
