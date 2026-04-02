---
name: pr-check
description: Review code against Ventage project checklist before committing or creating a PR
disable-model-invocation: true
context: fork
---

## Current State

- Diff: !`git diff HEAD`
- Staged: !`git diff --cached`
- Status: !`git status --short`

## Checklist (from CLAUDE.md)

Review the changes against each item. For each, mark ✅ or ❌ with explanation:

- [ ] `.env` is not being committed (check staged files)
- [ ] No hardcoded API keys, tokens, or secrets in code
- [ ] TypeScript has no type errors (run `npx tsc --noEmit`)
- [ ] Python code has type annotations
- [ ] New database tables have RLS policies
- [ ] AI code never fabricates financial numbers — all numbers from code/data
- [ ] Commit message follows convention (`feat:` / `fix:` / `docs:` / `refactor:`)
- [ ] No `console.log` left in production code
- [ ] Environment variables use correct prefix (`NEXT_PUBLIC_` for client-visible only)

## Output

Provide a summary with pass/fail status and any issues that need to be fixed before merging.
