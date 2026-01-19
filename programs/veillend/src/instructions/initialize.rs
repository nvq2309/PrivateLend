use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};

use crate::state::*;
use crate::constants::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init,
        payer = authority,
        space = Vault::LEN,
        seeds = [VAULT_SEED, collateral_mint.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,
    
    #[account(
        init,
        payer = authority,
        space = ProtectionPool::LEN,
        seeds = [PROTECTION_POOL_SEED, vault.key().as_ref()],
        bump,
    )]
    pub protection_pool: Account<'info, ProtectionPool>,
    
    #[account(
        init,
        payer = authority,
        token::mint = collateral_mint,
        token::authority = vault_collateral_account,
        seeds = [VAULT_COLLATERAL_SEED, vault.key().as_ref()],
        bump,
    )]
    pub vault_collateral_account: Account<'info, TokenAccount>,
    
    #[account(
        init,
        payer = authority,
        token::mint = collateral_mint,
        token::authority = protection_reserve_account,
        seeds = [PROTECTION_RESERVE_SEED, vault.key().as_ref()],
        bump,
    )]
    pub protection_reserve_account: Account<'info, TokenAccount>,
    
    pub collateral_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize(
    ctx: Context<Initialize>,
    ltv_bps: u64,
    liquidation_threshold_bps: u64,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.authority = ctx.accounts.authority.key();
    vault.collateral_mint = ctx.accounts.collateral_mint.key();
    vault.total_collateral = 0;
    vault.total_borrowed = 0;
    vault.total_shares = 0;
    vault.ltv_bps = ltv_bps;
    vault.liquidation_threshold_bps = liquidation_threshold_bps;
    vault.is_paused = false;
    vault.bump = ctx.bumps.vault;
    
    let protection_pool = &mut ctx.accounts.protection_pool;
    protection_pool.vault = vault.key();
    protection_pool.reserve_balance = 0;
    protection_pool.total_coverage = 0;
    protection_pool.total_subscribers = 0;
    protection_pool.total_executions = 0;
    protection_pool.total_premium_collected = 0;
    protection_pool.total_protection_paid = 0;
    protection_pool.bump = ctx.bumps.protection_pool;
    
    emit!(VaultInitializedEvent {
        vault: vault.key(),
        authority: ctx.accounts.authority.key(),
        collateral_mint: ctx.accounts.collateral_mint.key(),
        ltv_bps,
        liquidation_threshold_bps,
    });
    
    Ok(())
}

#[event]
pub struct VaultInitializedEvent {
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub ltv_bps: u64,
    pub liquidation_threshold_bps: u64,
}
