# Secure Supply Debug Bundle

This bundle captures all interfaces and dependencies for the shielded supply flow (1 SOL), plus a state-tracking map and test references.

## 1) Deployment + bootstrap interfaces

### Shell scripts
```bash
# scripts/bootstrap-localnet.sh
anchor build
anchor deploy --provider.cluster localnet
node scripts/bootstrap.mjs

# scripts/bootstrap-devnet.sh
anchor build
anchor deploy --provider.cluster devnet
node scripts/bootstrap.mjs
```

### Bootstrap script (TS)
```ts
// scripts/bootstrap.mjs
const [vault] = PublicKey.findProgramAddressSync(
  [Buffer.from('vault'), collateralMint.toBuffer()],
  programId,
);
const [merkleTree] = PublicKey.findProgramAddressSync(
  [Buffer.from('merkle_tree'), vault.toBuffer()],
  programId,
);

await program.methods
  .initialize(new BN(7500), new BN(8500))
  .accountsStrict({ authority, vault, vaultCollateralAccount, merkleTree, collateralMint, ... })
  .rpc();

await program.methods
  .initializeMints()
  .accountsStrict({ authority, vault, receiptMint, borrowMint, ... })
  .rpc();

await program.methods
  .initializeProtection()
  .accountsStrict({ authority, vault, protectionPool, protectionReserveAccount, ... })
  .rpc();
```

## 2) On-chain interfaces (Rust)

### Program entrypoints
```rust
// programs/veillend/src/lib.rs
pub fn initialize(ctx: Context<Initialize>, ltv_bps: u64, liquidation_threshold_bps: u64) -> Result<()>
pub fn initialize_merkle_tree(ctx: Context<InitializeMerkleTree>) -> Result<()>
pub fn deposit_secure(
  ctx: Context<DepositSecure>,
  amount: u64,
  encrypted_balance: [u8; 32],
  client_pubkey: [u8; 32],
  note_hash: [u8; 32],
  commitment: [u8; 32],
) -> Result<()>
pub fn deposit_secure_spend(
  ctx: Context<DepositSecureSpend>,
  amount: u64,
  encrypted_balance: [u8; 32],
  current_commitment: [u8; 32],
  new_commitment: [u8; 32],
  nullifier: [u8; 32],
  proof: Groth16Proof,
  merkle_proof: Vec<[u8; 32]>,
  merkle_path: Vec<u8>,
) -> Result<()>
```

### Vault + Merkle init
```rust
// programs/veillend/src/instructions/initialize.rs
pub fn initialize(ctx: Context<Initialize>, ltv_bps: u64, liquidation_threshold_bps: u64) -> Result<()>

// programs/veillend/src/instructions/initialize_merkle_tree.rs
pub fn initialize_merkle_tree(ctx: Context<InitializeMerkleTree>) -> Result<()>
```

### Secure supply (first vs spend)
```rust
// programs/veillend/src/instructions/deposit_secure.rs
pub fn deposit_secure(
  ctx: Context<DepositSecure>,
  amount: u64,
  encrypted_balance: [u8; 32],
  client_pubkey: [u8; 32],
  note_hash: [u8; 32],
  commitment: [u8; 32],
) -> Result<()>

// programs/veillend/src/instructions/deposit_secure_spend.rs
pub fn deposit_secure_spend(
  ctx: Context<DepositSecureSpend>,
  amount: u64,
  encrypted_balance: [u8; 32],
  current_commitment: [u8; 32],
  new_commitment: [u8; 32],
  nullifier: [u8; 32],
  proof: Groth16Proof,
  merkle_proof: Vec<[u8; 32]>,
  merkle_path: Vec<u8>,
) -> Result<()>
```

### Merkle helpers
```rust
// programs/veillend/src/merkle.rs
pub fn initialize_merkle_tree(tree: &mut MerkleTree) -> Result<()>
pub fn append_leaf(tree: &mut MerkleTree, leaf: [u8; 32]) -> Result<u32>
pub fn spend_note(
  tree: &MerkleTree,
  nullifier: &mut Nullifier,
  vault: Pubkey,
  commitment: [u8; 32],
  proof: &Vec<[u8; 32]>,
  path: &Vec<u8>,
) -> Result<()>
```

### PDA seeds
```rust
// programs/veillend/src/constants.rs
pub const VAULT_SEED: &[u8] = b"vault";
pub const USER_RECEIPT_SEED: &[u8] = b"user_receipt";
pub const NOTE_RECEIPT_SEED: &[u8] = b"note_receipt";
pub const VAULT_COLLATERAL_SEED: &[u8] = b"vault_collateral";
pub const PROTECTION_POOL_SEED: &[u8] = b"protection_pool";
pub const PROTECTION_RESERVE_SEED: &[u8] = b"protection_reserve";
pub const RECEIPT_MINT_SEED: &[u8] = b"receipt";
pub const BORROW_MINT_SEED: &[u8] = b"borrow";
pub const MERKLE_TREE_SEED: &[u8] = b"merkle_tree";
pub const NULLIFIER_SEED: &[u8] = b"nullifier";
```

## 3) UI + SDK interfaces

### UI handlers
```ts
// src/App.tsx
const handleConfirm = async () => { /* calls secureAdapter.supply */ };
const handleSaveNote = async () => { /* persists rotated note */ };
const handleSaveSuccessNote = async () => { /* persists success note */ };
```

### SDK secure supply
```ts
// src/hooks/useVeilLend.ts
const secureDeposit = useCallback(async (amount: number) => { ... }, [...]);
const resolveShieldedNote = useCallback(async (vaultKey: PublicKey, requireNote: boolean) => { ... }, [...]);
const buildMerkleProofForNote = useCallback(async (note: PrivacyNoteV2, vaultKey: PublicKey) => { ... }, [...]);
const sendTransaction = useCallback(async (instructions: TransactionInstruction[], preInstructions: TransactionInstruction[] = []) => { ... }, [...]);
```

### Note + privacy storage
```ts
// src/sdk/notes.ts
export const createInitialNoteRecord = (walletAddress: string, noteHash: string): NoteRecord
export const rotateNoteRecord = (walletAddress: string, lastTxnId: string, note?: NoteRecord): Promise<NoteRecord>
export const saveNoteRecord = (record: NoteRecord): void

// src/sdk/commitment.ts
export const createPrivacyNote = async (params: { walletAddress: string; ... }): Promise<PrivacyNoteV2>
export const savePrivacyNote = (walletAddress: string, note: PrivacyNoteV2): void
export const getUnspentNotes = (walletAddress: string, vaultAddress?: string): PrivacyNoteV2[]
export const markNoteSpent = (walletAddress: string, nullifier: string, txnId: string): void
```

## 4) Dependency diagram (ASCII)

```
UI: ActionModal -> App.handleConfirm
  -> secureAdapter.supply (useVeilLend.secureDeposit)
     -> getNoteHashBytes
     -> resolveShieldedNote
        -> buildMerkleProofForNote
        -> or shieldPosition
     -> createPrivacyNote
     -> generateZkActionProof
     -> encodeInstruction(deposit_secure | deposit_secure_spend)
     -> sendTransaction (simulate -> sign -> confirm)
     -> savePrivacyNote + markNoteSpent + refresh

On-chain:
  initialize -> Vault + MerkleTree
  deposit_secure -> init_tree? -> transfer -> mint shares -> append_leaf
  deposit_secure_spend -> verify proof -> spend_note(nullifier) -> append_leaf
```

## 5) State tracking checklist (1 SOL shielded supply)

### UI state (App.tsx)
- action: `activeAction`, `activeSymbol`, `amount`, `mode`
- wallet: `walletAddress`
- secure artifacts: `note`, `pendingNote`, `proof`
- errors: `actionError`, `actionMessage`

### SDK state (useVeilLend)
- program: `programId`, `vaultAddress`, `merkleTreeAddress`
- note: `privacyNotes`, `note`, `merkleRoot`, `merkleNextIndex`
- position: `myPosition` (fast position detection)

### On-chain accounts
- `Vault`: total_collateral, total_shares, total_borrowed
- `MerkleTree`: root, next_index
- `NoteReceipt`: note_hash, shares, deposited_collateral, encrypted_balance
- `Nullifier`: spent

### Local storage keys
- `veillend.note:<wallet>`
- `veillend.privacy_note.v2:<wallet>`
- `veillend.secrets:<wallet>`
- `veillend.note_access:*`

## 6) Tests (existing)

- UI secure supply
  - File: `tests/ui/app.spec.ts`
  - `secure supply creates proof and rotates note` (lines 381-408)
  - `full shielded supply flow logs cleanly` (lines 410-436)
  - `secure supply USDC creates proof and rotates note` (lines 519-545)
  - Calls: `unlockVault` -> `openAction` -> `Shield and Execute` -> `Save to storage & clipboard`

- On-chain secure deposit
  - File: `tests/veillend.ts`
  - `should append commitment on secure deposit` (lines 488-585)
  - Calls: `program.methods.depositSecure(...)` and asserts merkle root

## 7) Debug logs added

- UI
  - `src/App.tsx` adds console.debug/error around `handleConfirm` and `handleSaveNote`

- SDK
  - `src/hooks/useVeilLend.ts` adds console.debug/error for `sendTransaction`, `resolveShieldedNote`, and `secureDeposit`

- On-chain
  - `programs/veillend/src/instructions/initialize.rs` uses `msg!` for init trace
  - `programs/veillend/src/instructions/initialize_merkle_tree.rs` uses `msg!` for init trace
  - `programs/veillend/src/instructions/deposit_secure.rs` uses `msg!` for totals + merkle
  - `programs/veillend/src/instructions/deposit_secure_spend.rs` uses `msg!` for totals + merkle

## 9) UI evidence (latest run)

### Playwright run
```bash
npx playwright test tests/ui/app.spec.ts -g "full shielded supply flow logs cleanly"
```

### Console capture (trimmed)
```
[acceptance] note string visible + copy/save enabled + shielded supply success
[acceptance] console errors []
[acceptance] console warnings [
  '[warning] Lit is in dev mode. Not recommended for production! See https://lit.dev/msg/dev-mode for more information.'
]
[acceptance] console logs [
  '[debug] [vite] connecting...',
  '[info] %cDownload the React DevTools for a better development experience: https://reactjs.org/link/react-devtools font-weight:bold',
  '[warning] Lit is in dev mode. Not recommended for production! See https://lit.dev/msg/dev-mode for more information.',
  '[debug] [vite] connected.',
  '[debug] [debug][ui] handleConfirm start {mode: SECURE, action: SUPPLY, symbol: SOL, amount: 1, wallet: e2e-wallet}',
  '[debug] [debug][ui] supply submitted {signature: e2e_19c0a82e749_764efcd1, hasProof: true}',
  '[debug] [debug][ui] handleSaveNote {noteHashPrefix: ababc199, hasNoteString: false}'
]
```

## 10) Phantom integration attempt (automation limits)

### Extension artifact
- CRX: `Phantom - Chrome Web Store 26.2.0.0.crx`
- Unpacked: `debug/phantom-extension/`

### Automation blocker
- Playwright MCP blocks navigation to `chrome://extensions/` and does not allow launching a new Chromium context with `--load-extension` (no `require`/dynamic import in tool sandbox). Extension install is not possible through this toolchain.

### Phantom connect attempt (MCP browser)
```text
WalletConnectionError: Unexpected error
  at StandardWalletAdapter._StandardWalletAdapter_connect2 (.../chunk-RWND3W2J.js:5415:15)
```
- Additional console error from Phantom content script:
```text
Error: Something went wrong.
  at O3 (chrome-extension://bfnaelmomeimhlpmgjnjophhpkkoljpa/solanaActionsContentScript.js:65:43325)
```
- `window.solana` is present (`isPhantom: true`, `connect` and `request` exist), but `connect({ onlyIfTrusted: true })` returns "Unexpected error".
- No Phantom approval popup was opened; extension URLs are blocked by MCP tooling.

### Docs notes (automation + testing alternatives)
- Phantom Auto-Confirm only activates when the user enables it, the request comes from a verified domain, and the transaction targets approved contracts; otherwise Phantom shows a standard approval dialog (limits automation for unverified/test flows).
  - Source: https://docs.phantom.com/phantom-portal/contracts
- Official Solana wallet-adapter docs recommend `UnsafeBurnerWalletAdapter` as a default local-keypair signer for development/testing.
  - Sources: https://raw.githubusercontent.com/anza-xyz/wallet-adapter/master/packages/wallets/unsafe-burner/README.md
  - Example usage in setup guide: https://raw.githubusercontent.com/anza-xyz/wallet-adapter/master/APP.md
- Solana Mobile testing guidance recommends using the Mock MWA Wallet for testing Mobile Wallet Adapter flows (simulates wallet behaviors like sign-in and signing).
  - Source: https://docs.solanamobile.com/react-native/test-with-any-android-device
- Solana Mobile MWA support is limited by platform/browser (iOS and many mobile browsers are not supported), which constrains automation options outside Android Chrome.
  - Source: https://docs.solanamobile.com/developers/mobile-wallet-adapter

## 11) UI two-wallet integration (E2E TestWalletAdapter)

### Playwright run
```bash
npx playwright test tests/ui/app.spec.ts -g "two wallets share note and position state"
```

### Result
```
1 passed (15.3s)
```

### TestWalletAdapter strict flow (Phantom-like)
- Adapter now mirrors Phantom-style lifecycle: readyState change, connect/disconnect errors, and explicit wallet logs.
- Implemented `signTransaction` and `sendTransaction` tracing with strict `[wallet]` logs to correlate UI → SDK → wallet → RPC.

## 8) Debug-run order (no commands executed)

1) Open console, trigger secure supply with 1 SOL.
2) Capture browser console logs (`[debug][ui]`, `[debug][sdk]`).
3) If tx fails: capture simulation logs from error message.
4) If tx succeeds but UI does not update: check local storage keys.
