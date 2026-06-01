# Review: config normalization consolidation

## Blockers

None found.

## Should-fix

- Add focused regression tests for the newly centralized config-default behavior, especially configured API app/create precedence. The implementation is coherent, but the consolidation now puts several subtle semantics behind `mergeComplianceDefaults()` and `resolveProcessorRetryConfig()` in `src/core/runtime/config-defaults.ts:17-67` without direct tests for the helper or configured base/override combinations. Existing tests cover low-level legal-basis extension/replacement in `src/core/define.test.ts:174-228` and lazy adapter timing in `src/core/configure.test.ts:8-56`, but I did not find coverage for:
  - `configureHerald({ compliance: base }).create({ compliance: override })` legal-basis precedence where create-time legal bases override app-level legal bases (`config-defaults.ts:44-46`).
  - create-time `replaceDefaultLegalBases: false` overriding app-level `true`, and create-time `true` closing the merged app+create registry (`config-defaults.ts:41-54`).
  - retention partial merge precedence across defaults, app-level retention, and create-time retention (`config-defaults.ts:61-65`).
  - default queue behavior when `queue` is omitted and sync retry defaults are applied (`config-defaults.ts:17-34`).

## Optional notes

- Legal-basis merge semantics look correct for the stated intent. `replaceDefaultLegalBases` is resolved with create-time override precedence over app-level config (`override?.replaceDefaultLegalBases ?? base?.replaceDefaultLegalBases` at `src/core/runtime/config-defaults.ts:41-42`). Custom legal bases merge app-level first, then create-time (`config-defaults.ts:44-46`), so create-time definitions win on key conflicts. When replacement is false/undefined, built-ins are included first and custom entries override them (`config-defaults.ts:49-54`); when replacement is true, only merged custom entries are used (`config-defaults.ts:49-50`).

- Retention defaults and override precedence look correct. Defaults are centralized as `deliveryRetention: "90d"`, `auditLogRetention: "2y"`, `autoPurge: true` (`src/core/runtime/config-defaults.ts:5-9`). The normalized return merges defaults, then app-level retention, then create-time retention (`config-defaults.ts:61-65`), which preserves partial overrides.

- Queue retry defaults look consistent with the existing queue model. `resolveQueueConfig()` defaults omitted queue config to sync (`src/core/runtime/config-defaults.ts:17-20`). Processor retries are only enabled for the sync driver and default to `0` retries / exponential / `1000`ms (`config-defaults.ts:23-34`). Durable queue retry ownership remains in queue/runtime paths: pg-boss enqueue uses `config.retries ?? 3`, `config.backoffDelay ?? 1000`, and exponential only when requested (`src/queue/index.ts:105-128`), while runtime failed-delivery revival still uses `queueConfig.retries ?? 3` for db/adapter (`src/core/herald.ts:92-95`).

- Lazy email adapter resolution was not moved earlier. `configureHerald()` only validates channel keys at app construction (`src/core/configure.ts:170-171`, `264-281`). The adapter factory is invoked inside `create()` through `resolveRuntimeChannels()` / `resolveEmailChannelConfig()` (`configure.ts:203-205`, `291-308`). Existing test `src/core/configure.test.ts:8-56` verifies the factory is not called by `configureHerald()` or `defineEvent()`, and is called once by `create()`.

- Low-level runtime normalization remains separate from configured API normalization. `createHerald()` still calls `normalizeHeraldRuntimeConfig()` (`src/core/herald.ts:46-50`), which resolves queue defaults, processor retry defaults, runtime channels, and compliance defaults (`src/core/runtime/config-normalization.ts:53-67`). Configured API `create()` still builds the app-scoped runtime payload directly and passes normalized queue/retry/compliance into `createHeraldRuntime()` (`src/core/configure.ts:191-219`).

- Public export churn appears avoided. The new `config-defaults.ts` exports are internal source exports only; root public exports in `src/index.ts` do not expose `DEFAULT_RETENTION_CONFIG`, `mergeComplianceDefaults`, or queue normalization helpers, and `package.json` exports only package entrypoints under `dist`.

## Verification run

- `npm run typecheck` — passed.
- `npx vitest run src/core/configure.test.ts src/__tests__/integration/process-delivery.test.ts src/__tests__/integration/compliance-erase.test.ts` — passed, 3 files / 34 tests.
- `npm run lint` — completed with 57 pre-existing-style warnings and 0 errors; warnings are in adapters/queue/types files, not the reviewed config-normalization files.

## Review limitation

- This checkout has no `.git` metadata available (`git status` failed with “not a git repository”), so I reviewed the current files directly rather than an actual git diff.
