use anchor_lang::prelude::*;

#[error_code]
pub enum VeilLendError {
    #[msg("Arithmetic overflow occurred")]
    MathOverflow,
    
    #[msg("Invalid vault state")]
    InvalidVaultState,
    
    #[msg("Unauthorized access")]
    Unauthorized,
    
    #[msg("Insufficient collateral for operation")]
    InsufficientCollateral,
    
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
    
    #[msg("Vault is paused")]
    VaultPaused,
    
    #[msg("Invalid oracle price")]
    InvalidOraclePrice,
    
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    
    #[msg("Position has no debt")]
    NoDebt,
    
    #[msg("Protection already active")]
    ProtectionAlreadyActive,
}
