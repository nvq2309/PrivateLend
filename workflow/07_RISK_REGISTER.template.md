# Risk Register (Template)

Purpose: de-risk early. In Web3, most time loss is integration uncertainty.

For each risk:
- ID:
- Risk:
- Impact:
- Likelihood:
- Mitigation:
- Early test (run within the first 10–20% of the project):
- Owner:
- Status: open | mitigated | accepted

Example risks to always consider
- Wallet switching state invalidation leads to incorrect UI data
- Chain confirmations / finality differences produce race conditions
- ABI/IDL drift between deployed program and frontend client
- Indexer lag creates mismatched balances between API and RPC
- Decimal / rounding / token account mismatches
- Localnet vs devnet behavioral differences
- Privacy note/key management and import/export correctness

