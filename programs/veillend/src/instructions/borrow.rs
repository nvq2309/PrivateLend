use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};

use crate::state::*;
use crate::errors::VeilLendError;
use crate::constants::*;

#[derive(Accounts)]
pub struct Borrow<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [VAULT_SEED, collateral_mint.key().as_ref()],
        bump = vault.bump,
        constraint = !vault.is_paused @ VeilLendError::VaultPaused,
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

pub fn borrow(ctx: Context<Borrow>, amount: u64) -> Result<()> {
    require!(amount > 0, VeilLendError::InsufficientLiquidity);
    
    let user_receipt = &ctx.accounts.user_receipt;
    let vault = &ctx.accounts.vault;
    
    let max_borrow = user_receipt.deposited_collateral
        .checked_mul(vault.ltv_bps)
        .ok_or(VeilLendError::MathOverflow)?
        .checked_div(10000)
        .ok_or(VeilLendError::MathOverflow)?;
    
    let new_borrow = user_receipt.borrowed_amount
        .checked_add(amount)
        .ok_or(VeilLendError::MathOverflow)?;
    
    require!(new_borrow <= max_borrow, VeilLendError::HealthFactorTooLow);
    
    require!(
        ctx.accounts.vault_collateral_account.amount >= amount,
        VeilLendError::InsufficientLiquidity
    );
    
    let vault_key = ctx.accounts.vault.key();
    let seeds = &[
        VAULT_COLLATERAL_SEED,
        vault_key.as_ref(),
        &[ctx.bumps.vault_collateral_account],
    ];
    let signer_seeds = &[&seeds[..]];
    
    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault_collateral_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.vault_collateral_account.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, amount)?;
    
    let vault = &mut ctx.accounts.vault;
    vault.total_borrowed = vault.total_borrowed
        .checked_add(amount)
        .ok_or(VeilLendError::MathOverflow)?;
    
    let user_receipt = &mut ctx.accounts.user_receipt;
    let clock = Clock::get()?;
    
    user_receipt.borrowed_amount = new_borrow;
    user_receipt.last_update_timestamp = clock.unix_timestamp;
    
    emit!(BorrowEvent {
        vault: vault.key(),
        user: ctx.accounts.user.key(),
        amount,
        total_borrowed: user_receipt.borrowed_amount,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

#[event]
pub struct BorrowEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub total_borrowed: u64,
    pub timestamp: i64,
}
