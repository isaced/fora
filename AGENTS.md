# Agent conventions

- fora is agent-first: prefer stable `--json` output, actionable errors, low token cost, and one-call workflows over agent-side loops.
- Write all commit messages, PR titles, and PR descriptions in English, using Conventional Commits (`<type>(<scope>): <summary>`).
- Run `bun run typecheck` and `bun test` before committing.
