# Debugging Process Template (Generalized)

Use this checklist for any interactive bug where UI action appears to do nothing.

## 1) Identify the exact user action
- UI control name
- Expected result
- Actual result

## 2) Trace the path (UI -> SDK -> chain)
- UI handler(s)
- SDK function(s)
- On-chain instruction(s)
- Storage side effects (local storage, cache)

## 3) Add minimal logs (safe, no secrets)
- UI: entry + result + error
- SDK: params + branching choice + tx signature
- Chain: msg! on entry, branch, and exit

## 4) Capture runtime signals
- Browser console logs
- Transaction simulation logs
- On-chain logs (logsSubscribe or explorer)

## 5) Verify state transitions
- Local storage entries
- SDK state (notes, merkle root, position)
- On-chain account states (vault, merkle, note receipt, nullifier)

## 6) Test coverage map
- Existing test(s) that match the flow
- If none: create a minimal test that reproduces the exact UI action

## 7) Close the loop
- Summarize the branch where the flow stops
- Validate fix with existing tests
