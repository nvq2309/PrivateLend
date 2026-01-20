use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("VeilLend111111111111111111111111111111111111111");

#[program]
pub mod veillend {
    use super::*;

    // From PR#2 - initialization
    pub fn initialize(
        ctx: Context<Initialize>,
        ltv_bps: u64,
        liquidation_threshold_bps: u64,
    ) -> Result<()> {
        instructions::initialize::initialize(ctx, ltv_bps, liquidation_threshold_bps)
    }

    // From main - with Arcium encryption
    pub fn deposit(
        ctx: Context<Deposit>,
        amount: u64,
        encrypted_balance: [u8; 32],
        client_pubkey: [u8; 32],
    ) -> Result<()> {
        instructions::deposit::deposit(ctx, amount, encrypted_balance, client_pubkey)
    }

    pub fn withdraw(
        ctx: Context<Withdraw>,
        shares_to_burn: u64,
        encrypted_balance: [u8; 32],
    ) -> Result<()> {
        instructions::withdraw::withdraw(ctx, shares_to_burn, encrypted_balance)
    }

    pub fn borrow(
        ctx: Context<Borrow>,
        amount: u64,
        encrypted_balance: [u8; 32],
    ) -> Result<()> {
        instructions::borrow::borrow(ctx, amount, encrypted_balance)
    }

    pub fn repay(
        ctx: Context<Repay>,
        amount: u64,
        encrypted_balance: [u8; 32],
    ) -> Result<()> {
        instructions::repay::repay(ctx, amount, encrypted_balance)
    }

    // From PR#2 - protection system
    pub fn subscribe_protection(
        ctx: Context<SubscribeProtection>,
        tier: u8,
        duration_days: u16,
    ) -> Result<()> {
        instructions::subscribe_protection::subscribe_protection(ctx, tier, duration_days)
    }

    pub fn execute_protection(ctx: Context<ExecuteProtection>) -> Result<()> {
        instructions::execute_protection::execute_protection(ctx)
    }
}
