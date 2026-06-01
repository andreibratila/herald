# Code Context

## Files Retrieved
1. `openspec/archive/2026-06-01/database-adapter-conformance/archive-report.md` (lines 1-33) - confirms database-adapter-conformance is archived and canonical spec exists.
2. `openspec/archive/2026-05-31/split-send-pipeline-phases/archive-report.md` (lines 1-29) - confirms split-send artifacts are archived and canonical spec exists.
3. `openspec/archive/2026-05-31/split-types-barrel/archive-report.md` (lines 1-29) - confirms split-types artifacts are archived and canonical spec exists.
4. `openspec/config.yaml` (lines 1-9) - project OpenSpec config; keep.
5. `.gga` (lines 1-80) - project-local guardian config; keep/confirm before deleting.
6. `audit/architecture-debt-plan.md` (lines 1-80) - potentially useful active/historical planning doc.
7. `audit/handoff-plan.md` (lines 1-80) - broad architecture/refactor handoff; potentially useful.
8. `audit/reviewer-code-health.md` (lines 1-80) - code-health findings; potentially useful historical design/audit.
9. `audit/runtime-test-split-plan.md` (lines 1-80) - completed test-split plan; now duplicated by current test files.
10. `audit/scout-architecture.md` (lines 1-80) - broad architecture scout; potentially useful.
11. `audit/review-config-normalization.md` (lines 1-80) - recent review with possible follow-up test notes.
12. `context.md` (previous lines 1-120) - stale root scout artifact; overwritten by this report.

## Key Code
No source code needs deletion. Important inventory facts:

- `openspec/changes/` is empty; keep the directory as the OpenSpec active-change workspace.
- Canonical specs exist and should be kept:
  - `openspec/specs/database-adapter/spec.md`
  - `openspec/specs/send-runtime/spec.md`
  - `openspec/specs/types/spec.md`
- Canonical archives exist and should be kept:
  - `openspec/archive/2026-06-01/database-adapter-conformance/`
  - `openspec/archive/2026-05-31/split-send-pipeline-phases/`
  - `openspec/archive/2026-05-31/split-types-barrel/`
- Runtime/session generated state found:
  - `.pi-lens/` is cache/index/metrics/worklog state (~9 MB), safe to remove if you do not need local lens history.
  - `.pi/` contains project-local Pi SDD agent/chain assets and settings; do not delete without confirmation.
- `.backup/herald.test.ts.before-runtime-split.20260601-185704` is a one-off source backup. It is likely stale, but because this directory is not a git repo, ask before deleting.

## Architecture
This repo uses OpenSpec as the canonical project artifact store. Completed SDD changes are represented by canonical specs under `openspec/specs/` and immutable change records under `openspec/archive/`. Files under `artifacts/` and most files under `audit/` are transient subagent/review/phase reports created during those completed flows. Once the corresponding OpenSpec archive exists, those transient reports are duplicated and safe to clean.

## Delete now
These are completed/stale transient artifacts, duplicated by canonical OpenSpec archives/specs or current source/test layout.

1. `artifacts/` - all files are database-adapter-conformance SDD phase/apply/review/scout reports; `openspec/archive/2026-06-01/database-adapter-conformance/` is canonical now.
2. Completed split-send/split-types audit files duplicated by `openspec/archive/2026-05-31/`:
   - `audit/sdd-*split-send*.md`
   - `audit/sdd-*split-types*.md`
   - `audit/review-split-send-*.md`
   - `audit/review-split-types-*.md`
   - `audit/split-send-slice-*-worker.md`
   - `audit/split-types-pr*-worker.md`
3. Completed transient implementation/review scratch:
   - `audit/runtime-test-split-plan.md` - current focused runtime test files exist.
   - `audit/processor-refactor-worker.md`
   - `audit/review-processor-refactor.md`
   - `audit/review-composer-leftovers.md`
   - `audit/review-scheduled-worker-fix.md`
4. Generated local/session state:
   - `.pi-lens/` - local cache/index/metrics only.
   - `coverage/` - generated test coverage output.

Proposed cleanup commands:

```bash
rm -rf artifacts
rm -f audit/sdd-*split-send*.md audit/sdd-*split-types*.md
rm -f audit/review-split-send-*.md audit/review-split-types-*.md
rm -f audit/split-send-slice-*-worker.md audit/split-types-pr*-worker.md
rm -f audit/runtime-test-split-plan.md \
      audit/processor-refactor-worker.md \
      audit/review-processor-refactor.md \
      audit/review-composer-leftovers.md \
      audit/review-scheduled-worker-fix.md
rm -rf .pi-lens coverage
```

## Keep
Do not delete these without a separate project decision.

- Source/docs/package/config/test files: `src/`, `docs/`, `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`, `package-lock.json`, `bun.lock`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`, `CLAUDE.md`.
- OpenSpec canonical artifacts: `openspec/config.yaml`, `openspec/specs/`, `openspec/archive/`.
- `openspec/changes/` - empty but useful active-change workspace.
- `.env` - do not print or delete as part of artifact cleanup.
- `.gga` - project-local guardian config.
- `.pi/` - local Pi SDD/harness assets and settings.
- `node_modules/` - dependency install; removable only as dependency cleanup, not artifact cleanup.
- `dist/` - generated build output, but may be expected for local package consumption; ask first.
- `.vscode/`, `.atl/` - local/project configuration; ask first.

## Ask before deleting
Ambiguous or potentially useful historical docs/state:

- `.backup/herald.test.ts.before-runtime-split.20260601-185704` - likely stale backup, but this is not a git repo.
- `audit/architecture-debt-plan.md` - may contain still-useful follow-up architecture plan.
- `audit/handoff-plan.md` - broad refactor handoff/context.
- `audit/reviewer-code-health.md` - broad code-health review and possible future work.
- `audit/scout-architecture.md` - broad architecture scout.
- `audit/review-config-normalization.md` - recent review with potential should-fix regression-test notes.
- `dist/` - safe to regenerate via build in normal repos, but confirm because no git metadata and this is a package library.
- This `context.md` report - delete after you have consumed it if you do not want a root scratch file.

Optional command after confirmation:

```bash
rm -rf .backup
rm -f audit/architecture-debt-plan.md audit/handoff-plan.md \
      audit/reviewer-code-health.md audit/scout-architecture.md \
      audit/review-config-normalization.md
rm -rf dist
rm -f context.md
```

## Start Here
Run the first cleanup command block under **Delete now**. It removes only transient reports/caches and leaves source, docs, package files, OpenSpec specs/archive, `.env`, and ambiguous historical planning docs intact.

## Supervisor coordination
No supervisor decision was needed. Engram/memory tools were not available in this subagent toolset, so no project memory save could be performed.
