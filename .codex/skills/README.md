# Project skills

## Flint chart author

`flint-chart-author/SKILL.md` is an unmodified copy of the official skill recommended by [Agent Workflows](https://microsoft.github.io/flint-chart/#/zh/documentation/agent-workflows).

- Repository: [microsoft/flint-chart](https://github.com/microsoft/flint-chart).
- Commit: `683d5de1ffd0c1a76001ca5aa044f297276d7734`.
- Source: [agent-skills/flint-chart-author/SKILL.md](https://github.com/microsoft/flint-chart/blob/683d5de1ffd0c1a76001ca5aa044f297276d7734/agent-skills/flint-chart-author/SKILL.md).
- Installed: 2026-10-04.
- SHA-256: `2886e9057da56c251f9a1bfc7f5f5cbd199cf1ea0428d02ae2e6cc46d2370c0a`.
- License: MIT; see `flint-chart-author/LICENSE`.

This is a repository-local coding-agent skill. Invoke it with `$flint-chart-author`; `AGENTS.md` also routes relevant tasks to it. Installing it does not change the Panel's runtime AI prompts, dependencies, or MCP configuration.

Project-specific constraints live in `AGENTS.md`, separate from the upstream skill. The official workflow recommends chart authoring; the separate upstream theme-author skill is not installed here.

## Updating the upstream copy

1. Choose a reviewed commit from the official repository and inspect the skill diff, including any new bundled resources.
2. Replace the skill package from that commit, keeping `SKILL.md` byte-for-byte identical to upstream and retaining the MIT license.
3. Update the commit, source link, installation date, and SHA-256 above.
4. Check YAML frontmatter, linked resource paths, and compatibility with the installed Flint library and Panel validator. Keep project policy in `AGENTS.md`.

The vendored `SKILL.md` is excluded in `.prettierignore`; automatic formatting would invalidate its upstream hash.
