use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};

use crate::state::*;
use crate::errors::VeilLendError;
use crate::constants::*;

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [VAULT_SEED, collateral_mint.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
    
    #[account(
        mut,
        seeds = [USER_RECEIPT_SEED, vault.key().as_ref(), user.key().as_ref()],
        bump = user_receipt.bump,
        constraint = user_receipt.owner == user.key() @ VeilLendError::Unauthorized,
    )]
    pub user_receipt: Account<'info, UserReceipt>,
    
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ VeilLendError::Unauthorized,
        constraint = user_token_account.mint == collateral_mint.key(),
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [VAULT_COLLATERAL_SEED, vault.key().as_ref()],
        bump,
    )]
    pub vault_collateral_account: Account<'info, TokenAccount>,
    
    pub collateral_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
    let user_receipt = &ctx.accounts.user_receipt;
    
    require!(user_receipt.borrowed_amount > 0, VeilLendError::NoDebt);
    
    let repay_amount = std::cmp::min(amount, user_receipt.borrowed_amount);
    
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_collateral_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, repay_amount)?;
    
    let vault = &mut ctx.accounts.vault;
    vault.total_borrowed = vault.total_borrowed
        .saturating_sub(repay_amount);
    
    let user_receipt = &mut ctx.accounts.user_receipt;
    let clock = Clock::get()?;
    
    user_receipt.borrowed_amount = user_receipt.borrowed_amount
        .saturating_sub(repay_amount);
    user_receipt.last_update_timestamp = clock.unix_timestamp;
    
    emit!(RepayEvent {
        vault: vault.key(),
        user: ctx.accounts.user.key(),
        amount: repay_amount,
        remaining_debt: user_receipt.borrowed_amount,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

#[event]
pub struct RepayEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub remaining_debt: u64,
    pub timestamp: i64,
}
