use anchor_lang::prelude::*;

#[error_code]
pub enum VeilLendError {
    // From main
    #[msg("Vault is currently paused")]
    VaultPaused,
    #[msg("Insufficient collateral provided")]
    InsufficientCollateral,
    #[msg("Insufficient shares to complete this action")]
    InsufficientShares,
    #[msg("Outstanding debt must be repaid before withdrawal")]
    OutstandingDebt,
    #[msg("Borrow amount exceeds collateral limit")]
    BorrowLimitExceeded,
    #[msg("Arithmetic overflow or underflow detected")]
    MathOverflow,
    // From PR#2
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Invalid vault state")]
    InvalidVaultState,
    #[msg("Insufficient liquidity in vault")]
    InsufficientLiquidity,
    #[msg("Health factor too low for operation")]
    HealthFactorTooLow,
    #[msg("Invalid protection tier (must be 0, 1, or 2)")]
    InvalidProtectionTier,
    #[msg("No active protection subscription")]
    NoProtection,
    #[msg("Protection subscription has expired")]
    ProtectionExpired,
    #[msg("Insufficient protection reserve")]
    InsufficientProtectionReserve,
    #[msg("Invalid protection duration (must be 7-365 days)")]
    InvalidDuration,
    #[msg("Position health factor is still safe")]
    HealthFactorSafe,
    #[msg("Invalid oracle price")]
    InvalidOraclePrice,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Position has no debt")]
    NoDebt,
    #[msg("Protection already active")]
    ProtectionAlreadyActive,
    #[msg("Merkle tree is full")]
    MerkleTreeFull,
    #[msg("Merkle proof verification failed")]
    MerkleProofInvalid,
    #[msg("Nullifier already spent")]
    NullifierAlreadySpent,
    #[msg("Invalid merkle path")]
    InvalidMerklePath,
    #[msg("Merkle tree depth mismatch")]
    MerkleDepthMismatch,
    #[msg("Poseidon hash failed")]
    PoseidonHashFailed,
    #[msg("Missing Arcium client public key")]
    ArciumClientKeyMissing,
    #[msg("Arcium client public key mismatch")]
    ArciumClientKeyMismatch,
    #[msg("Invalid note access hash")]
    InvalidNoteHash,
    #[msg("ZK proof verification failed")]
    ZkProofInvalid,
    #[msg("Invalid ZK proof inputs")]
    ZkInputInvalid,
}
