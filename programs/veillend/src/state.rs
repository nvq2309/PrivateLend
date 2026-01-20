use anchor_lang::prelude::*;

#[account]
pub struct Vault {
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub receipt_mint: Pubkey,
    pub borrow_mint: Pubkey,
    pub total_collateral: u64,
    pub total_shares: u64,
    pub is_paused: bool,
    pub bump: u8,
    pub reserved: [u8; 6],
}

impl Vault {
    pub const INIT_SPACE: usize = 32 + 32 + 32 + 32 + 8 + 8 + 1 + 1 + 6;
}

#[account]
pub struct UserReceipt {
    pub owner: Pubkey,
    pub vault: Pubkey,
    pub shares: u64,
    pub deposited_collateral: u64,
    pub borrowed_amount: u64,
    pub encrypted_balance: [u8; 32],
    pub client_pubkey: [u8; 32],
    pub bump: u8,
    pub reserved: [u8; 7],
}

impl UserReceipt {
    pub const INIT_SPACE: usize = 32 + 32 + 8 + 8 + 8 + 32 + 32 + 1 + 7;
}
