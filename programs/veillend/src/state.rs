use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct Vault {
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub total_collateral: u64,
    pub total_borrowed: u64,
    pub total_shares: u64,
    pub ltv_bps: u64,
    pub liquidation_threshold_bps: u64,
    pub is_paused: bool,
    pub bump: u8,
    pub reserve_padding: [u8; 64],
}

impl Vault {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 64;
}

#[account]
#[derive(Default)]
pub struct UserReceipt {
    pub owner: Pubkey,
    pub vault: Pubkey,
    pub deposited_collateral: u64,
    pub borrowed_amount: u64,
    pub shares: u64,
    pub protection_tier: u8,
    pub protection_expiry: i64,
    pub last_update_timestamp: i64,
    pub bump: u8,
    pub reserve_padding: [u8; 32],
}

impl UserReceipt {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1 + 8 + 8 + 1 + 32;
}

#[account]
#[derive(Default)]
pub struct ProtectionPool {
    pub vault: Pubkey,
    pub reserve_balance: u64,
    pub total_coverage: u64,
    pub total_subscribers: u64,
    pub total_executions: u64,
    pub total_premium_collected: u64,
    pub total_protection_paid: u64,
    pub bump: u8,
    pub reserve_padding: [u8; 64],
}

impl ProtectionPool {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 64;
}
