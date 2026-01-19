use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};

use crate::state::*;
use crate::errors::VeilLendError;
use crate::constants::*;

#[derive(Accounts)]
pub struct Withdraw<'info> {
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

pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let user_receipt = &ctx.accounts.user_receipt;
    let vault = &ctx.accounts.vault;
    
    require!(
        user_receipt.deposited_collateral >= amount,
        VeilLendError::InsufficientCollateral
    );
    
    if user_receipt.borrowed_amount > 0 {
        let new_collateral = user_receipt.deposited_collateral
            .checked_sub(amount)
            .ok_or(VeilLendError::MathOverflow)?;
        
        let max_borrow = new_collateral
            .checked_mul(vault.ltv_bps)
            .ok_or(VeilLendError::MathOverflow)?
            .checked_div(10000)
            .ok_or(VeilLendError::MathOverflow)?;
        
        require!(
            user_receipt.borrowed_amount <= max_borrow,
            VeilLendError::HealthFactorTooLow
        );
    }
    
    let shares_to_burn = if vault.total_collateral > 0 {
        amount
            .checked_mul(vault.total_shares)
            .ok_or(VeilLendError::MathOverflow)?
            .checked_div(vault.total_collateral)
            .ok_or(VeilLendError::MathOverflow)?
    } else {
        amount
    };
    
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
    vault.total_collateral = vault.total_collateral
        .saturating_sub(amount);
    vault.total_shares = vault.total_shares
        .saturating_sub(shares_to_burn);
    
    let user_receipt = &mut ctx.accounts.user_receipt;
    let clock = Clock::get()?;
    
    user_receipt.deposited_collateral = user_receipt.deposited_collateral
        .saturating_sub(amount);
    user_receipt.shares = user_receipt.shares
        .saturating_sub(shares_to_burn);
    user_receipt.last_update_timestamp = clock.unix_timestamp;
    
    emit!(WithdrawEvent {
        vault: vault.key(),
        user: ctx.accounts.user.key(),
        amount,
        shares_burned: shares_to_burn,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

#[event]
pub struct WithdrawEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub shares_burned: u64,
    pub timestamp: i64,
}
