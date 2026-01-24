use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

use crate::constants::*;
use crate::state::*;

#[derive(Accounts)]
pub struct InitializeMints<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        init,
        payer = authority,
        seeds = [RECEIPT_MINT_SEED, vault.key().as_ref()],
        bump,
        mint::decimals = 9,
        mint::authority = vault,
    )]
    pub receipt_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = authority,
        seeds = [BORROW_MINT_SEED, vault.key().as_ref()],
        bump,
        mint::decimals = 9,
        mint::authority = vault,
    )]
    pub borrow_mint: Box<Account<'info, Mint>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize_mints(ctx: Context<InitializeMints>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.receipt_mint = ctx.accounts.receipt_mint.key();
    vault.borrow_mint = ctx.accounts.borrow_mint.key();

    Ok(())
}
