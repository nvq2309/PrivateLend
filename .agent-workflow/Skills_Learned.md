# Skills Learned — VeilLend

Append-only catalog of anti-patterns and best practices extracted from retrospectives.
Agents should scan this before starting work.

## General

### Skill: Clarify Gate First
**Trigger:** Before coding on SECURE/money flows or when a test loop is painful
**Anti-pattern:** Coding while acceptance criteria / verification are unclear
**Best practice:** Ask 3–5 A/B/C/D questions (success, scope, verification, risk) before edits

### Skill: Batch Reads, Then Edit
**Trigger:** Starting any task that touches multiple files
**Anti-pattern:** Re-reading the same file repeatedly (context thrash)
**Best practice:** Identify needed files, then read them in one batch before edits

### Skill: Verify Before Claim
**Trigger:** Before flipping any `passes=true`
**Anti-pattern:** “Done” without evidence
**Best practice:** Run verification commands; log outputs in progress logs

### Skill: Failure Triage (A/B/C)
**Trigger:** When tests fail
**Anti-pattern:** Randomly changing code until green
**Best practice:** Classify first:
- A) Harness/environment
- B) Logic bug
- C) Spec mismatch

### Skill: Cross-Action Test Minimum
**Trigger:** Any change that touches stateful flows
**Anti-pattern:** Only unit tests; no end-to-end sequences
**Best practice:** Add at least one scenario/integration test that mixes actions (happy + unhappy)

## Solana / Anchor

### Skill: Kill Stale Validator
**Trigger:** Before Anchor test loops
**Anti-pattern:** Stale validator state / port collisions
**Best practice:** `pkill -f solana-test-validator || true` (and `solana-faucet` if used)

### Skill: Tight-Loop Grep Invocation
**Trigger:** Targeted Anchor tests
**Anti-pattern:** Grep flag consumed by build tooling
**Best practice:** Use `TEST_GREP="pattern" COPYFILE_DISABLE=1 anchor test --skip-local-validator`

### Skill: Compute Budget Hygiene (SECURE)
**Trigger:** Any tx with ZK verification / heavy CPI
**Anti-pattern:** ComputeBudgetExceeded late in the loop
**Best practice:** Treat compute budget + tx size as acceptance constraints; test early

### Skill: Derive, Don’t Pass (Tx Size)
**Trigger:** Large instruction args
**Anti-pattern:** Passing derivable values increases tx size
**Best practice:** Derive from accounts/PDAs when safe; record trade-offs in ADR

## Adding new skills
Use this format:
```markdown
### Skill: [Name]
**Trigger:** [when]
**Anti-pattern:** [avoid]
**Best practice:** [do this]
**Evidence:** [Progress/Retro entry]
```
