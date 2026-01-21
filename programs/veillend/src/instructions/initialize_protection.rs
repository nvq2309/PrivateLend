use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};

use crate::state::*;
use crate::constants::*;

#[derive(Accounts)]
pub struct InitializeProtection<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub vault: Box<Account<'info, Vault>>, // Vault needs to exist now
    
    #[account(
        init,
        payer = authority,
        space = ProtectionPool::LEN,
        seeds = [PROTECTION_POOL_SEED, vault.key().as_ref()],
        bump,
    )]
    pub protection_pool: Box<Account<'info, ProtectionPool>>,
    
    #[account(
        init,
        payer = authority,
        token::mint = collateral_mint,
        token::authority = protection_reserve_account,
        seeds = [PROTECTION_RESERVE_SEED, vault.key().as_ref()],
        bump,
    )]
    pub protection_reserve_account: Box<Account<'info, TokenAccount>>,
    
    pub collateral_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize_protection(
    ctx: Context<InitializeProtection>,
) -> Result<()> {
    let protection_pool = &mut ctx.accounts.protection_pool;
    protection_pool.vault = ctx.accounts.vault.key();
    protection_pool.reserve_balance = 0;
    protection_pool.total_coverage = 0;
    protection_pool.total_subscribers = 0;
    protection_pool.total_executions = 0;
    protection_pool.total_premium_collected = 0;
    protection_pool.total_protection_paid = 0;
    protection_pool.bump = ctx.bumps.protection_pool;
    
    Ok(())
}
