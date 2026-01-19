use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("VeiLXJNVnEgYFqEGMHMzY1HnQWpLLFLEjKWTWxGJGxK");

#[program]
pub mod veillend {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        ltv_bps: u64,
        liquidation_threshold_bps: u64,
    ) -> Result<()> {
        instructions::initialize::initialize(ctx, ltv_bps, liquidation_threshold_bps)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::withdraw(ctx, amount)
    }

    pub fn borrow(ctx: Context<Borrow>, amount: u64) -> Result<()> {
        instructions::borrow::borrow(ctx, amount)
    }

    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        instructions::repay::repay(ctx, amount)
    }

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
