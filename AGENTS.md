# AGENTS.md

This guide is for agentic coding assistants working in this repository.
It prioritizes the root app in `/Users/cherry/Desktop/Demo Codes/PrivateLend`.

## Quick Orientation
- React + TypeScript + Vite frontend in `src/`.
- Solana Anchor tests in `tests/` (Mocha + Chai).
- Tailwind CSS via `tailwind.config.js`.
- On-chain interaction helpers in `src/sdk/` and `src/hooks/`.

## Build, Lint, Test

### Install
- `npm install`

### Dev Server
- `npm run dev`

### Build
- `npm run build`

### Preview
- `npm run preview`

### Lint
- `npm run lint`

### Tests (Anchor)
- `npm run test` (alias for `anchor test`)
- `npm run test:local` (alias for `anchor test --skip-local-validator`)

### Run A Single Test
Anchor uses Mocha under the hood. Pass Mocha args after `--`.
- Run one test file:
  - `anchor test -- --grep "VeilLend" tests/veillend.ts`
- Run a single test case by name:
  - `anchor test -- --grep "should deposit collateral"`
- If a local validator is already running:
  - `anchor test --skip-local-validator -- --grep "should deposit collateral"`

### Anchor Tooling Notes
- Recommended workflow from `tests/README.md`:
  - `anchor build`
  - `anchor test` (starts local validator automatically)
- Manual flow:
  - `solana-test-validator --reset`
  - `anchor build && anchor deploy`
  - `anchor test --skip-local-validator`

## Code Style Guide

### Language + Framework
- TypeScript with `strict` compiler settings (`tsconfig.json`).
- React function components and hooks.
- Vite build tooling; ES modules (`type: module`).

### Imports
- Use ESM `import` syntax everywhere.
- Prefer grouping imports in this order:
  1. React/core libs
  2. Third-party packages (Solana, Anchor, etc.)
  3. Local modules (relative paths)
- Keep imports named and explicit; avoid `require`.
- Use file extensions in TS imports when already used (`./App.tsx`).

### Formatting
- 2-space indentation.
- Semicolons are used in existing files (`src/App.tsx`).
- Single quotes for strings in TS/TSX.
- Trailing commas in multiline objects/arrays and function args.
- Keep JSX props aligned one per line when lengthy.

### Naming Conventions
- Components: PascalCase (`Layout`, `RiskIndicator`).
- Hooks: `useX` prefix (`useVeilLend`).
- Types/interfaces: PascalCase (`Position`, `NoteRecord`).
- Constants: `SCREAMING_SNAKE_CASE` for globals and config (`WSOL_MINT`).
- Local helpers: camelCase (`formatAmount`, `parseAmount`).

### Types
- Prefer `type` for simple shapes and unions; `interface` for public object shapes.
- Avoid `any` unless dealing with external data (keep it localized).
- Use explicit return types for exported functions when clarity helps.
- Use union types for variants (`'FAST' | 'SECURE'`).

### React + Hooks
- Keep hooks at the top level of components.
- Use `useMemo`/`useCallback` for derived data and stable handlers.
- Local UI state via `useState`.
- Keep side effects in `useEffect`, guard with null checks.

### Error Handling
- Throw `Error` with descriptive messages for fatal cases.
- In `catch`, prefer:
  - `const message = error instanceof Error ? error.message : 'Fallback message.'`
- Guard browser-only APIs (`localStorage`, `crypto`) with feature checks.
- Prefer early returns to reduce nesting.

### Solana + Anchor Conventions
- Validate `publicKey` and program IDs before building transactions.
- Use PDA derivation helpers to avoid duplicated seed logic.
- Ensure transaction instructions include all required accounts.
- Refresh cached state after mutations (`refresh()` in hooks).

### Testing Conventions
- Mocha + Chai (see `tests/veillend.ts`).
- Use descriptive `describe` and `it` blocks.
- Anchor provider setup at suite top.
- Keep constants in uppercase and reuse for scenario steps.

### CSS + UI
- Tailwind CSS utility classes; keep className strings readable.
- Reuse shared components from `src/components/`.
- Keep typography and layout patterns consistent with existing UI.

## Files To Check First
- `package.json` for scripts and dependencies.
- `.eslintrc.cjs` for lint rules.
- `tsconfig.json` and `tsconfig.tests.json` for TS behavior.
- `tests/README.md` for Solana/Anchor setup.

## Agent Workflow Tips
- Keep edits minimal and aligned with existing patterns.
- Avoid reformatting unrelated blocks.
- Do not add new tools/configs unless required for the task.
- If you touch tests, ensure they still run under `anchor test`.
