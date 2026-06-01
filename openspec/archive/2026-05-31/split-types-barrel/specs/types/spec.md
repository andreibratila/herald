# Spec Delta: split-types-barrel

## ADDED Requirements

### Requirement: Types Source Organization Split
The implementation **MUST** decompose `src/types/index.ts` into focused domain modules under `src/types/` while retaining equivalent type declarations.

#### Scenario: Domain modules are introduced without semantic type redesign
- **Given** the pre-change monolithic `src/types/index.ts`
- **When** the split-types-barrel change is applied
- **Then** focused module files exist under `src/types/` for the moved declarations
- **And** moved declarations keep the same public names and structural semantics
- **And** no new dependency or tooling is introduced for this refactor

### Requirement: Compatibility Barrel Preservation
`src/types/index.ts` **MUST** remain the compatibility barrel for internal and external type access during this slice.

#### Scenario: Existing internal import path remains valid
- **Given** internal code importing from `src/types/index.ts`
- **When** the first split-types-barrel slice is merged
- **Then** those imports continue to resolve without required call-site rewrites outside `src/types/`

### Requirement: Root Public Type Surface Stability
The package root type surface exposed via `herald` **MUST** remain unchanged for existing exported type names.

#### Scenario: Root consumer imports remain valid
- **Given** a consumer importing currently exported types from `herald`
- **When** the package is built after the refactor
- **Then** the same type names remain available from the root package entrypoint
- **And** no public type rename is required

### Requirement: No Runtime or Behavioral Change
The refactor **MUST NOT** change runtime behavior, queue behavior, compliance behavior, adapter behavior, or persistence semantics.

#### Scenario: Behavior remains identical because change is organizational
- **Given** event dispatch, enqueue, processing, and compliance flows prior to refactor
- **When** split-types-barrel is applied
- **Then** runtime execution semantics are unchanged
- **And** only type source-file organization is altered

### Requirement: Package Export Map Stability
The change **MUST NOT** alter `package.json` export map or introduce new public type subpath exports.

#### Scenario: Package entrypoints stay unchanged
- **Given** current package exports
- **When** split-types-barrel is released
- **Then** no export-map entry is added, removed, or repointed for this change

### Requirement: Export Completeness Validation
Implementation validation **MUST** confirm that moved type declarations are fully re-exported through `src/types/index.ts` and the package root surface remains complete.

#### Scenario: Missing re-export is caught before completion
- **Given** type declarations moved into domain modules
- **When** verification runs (`npm run typecheck`, `npm run lint`, and declaration/build checks)
- **Then** missing or broken barrel exports are detected
- **And** the change is not considered complete until root type surface completeness is restored
