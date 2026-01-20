use anchor_lang::prelude::*;

#[error_code]
pub enum VeilLendError {
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
}
