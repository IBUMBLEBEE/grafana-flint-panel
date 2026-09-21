# Contributing

Thank you for helping improve Flint Panel.

## Development

Use Node.js 22 and npm 10. From a clean checkout:

```bash
npm ci
npm run typecheck
npm run lint
npm run test:ci
npm run build
docker compose up --build
```

Open <http://localhost:3000> and use the provisioned Flint dashboard. The panel renders without an AI datasource; AI Assist integrations are optional.

Before opening a pull request, also run:

```bash
npm run format:check
npm run audit:prod
npm run e2e
```

Keep changes focused, add tests for observable behavior, and update `CHANGELOG.md` when the change affects users. By contributing, you agree that your contribution is licensed under Apache-2.0.
