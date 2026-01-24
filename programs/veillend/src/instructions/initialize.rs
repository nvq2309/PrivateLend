use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::state::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Vault::INIT_SPACE,
        seeds = [VAULT_SEED, collateral_mint.key().as_ref()],
        bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        init,
        payer = authority,
        token::mint = collateral_mint,
        token::authority = vault,
        seeds = [VAULT_COLLATERAL_SEED, vault.key().as_ref()],
        bump,
    )]
    pub vault_collateral_account: Box<Account<'info, TokenAccount>>,

    pub collateral_mint: Box<Account<'info, Mint>>,
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
    // Receipt/Borrow mints initialized in initialize_mints
    vault.total_collateral = 0;
    vault.total_borrowed = 0;
    vault.total_shares = 0;
    vault.ltv_bps = ltv_bps;
    vault.liquidation_threshold_bps = liquidation_threshold_bps;
    vault.is_paused = false;
    vault.bump = ctx.bumps.vault;

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
