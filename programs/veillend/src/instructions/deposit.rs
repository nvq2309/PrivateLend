use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};

use crate::state::*;
use crate::errors::VeilLendError;
use crate::constants::*;

#[derive(Accounts)]
pub struct Deposit<'info> {
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
        init_if_needed,
        payer = user,
        space = UserReceipt::LEN,
        seeds = [USER_RECEIPT_SEED, vault.key().as_ref(), user.key().as_ref()],
        bump,
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
    pub system_program: Program<'info, System>,
}

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, VeilLendError::InsufficientCollateral);
    
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_collateral_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, amount)?;
    
    let vault = &mut ctx.accounts.vault;
    let shares = if vault.total_shares == 0 {
        amount
    } else {
        amount
            .checked_mul(vault.total_shares)
            .ok_or(VeilLendError::MathOverflow)?
            .checked_div(vault.total_collateral)
            .ok_or(VeilLendError::MathOverflow)?
    };
    
    vault.total_collateral = vault.total_collateral
        .checked_add(amount)
        .ok_or(VeilLendError::MathOverflow)?;
    vault.total_shares = vault.total_shares
        .checked_add(shares)
        .ok_or(VeilLendError::MathOverflow)?;
    
    let user_receipt = &mut ctx.accounts.user_receipt;
    let clock = Clock::get()?;
    
    if user_receipt.owner == Pubkey::default() {
        user_receipt.owner = ctx.accounts.user.key();
        user_receipt.vault = vault.key();
        user_receipt.protection_tier = 0;
        user_receipt.protection_expiry = 0;
        user_receipt.bump = ctx.bumps.user_receipt;
    }
    
    user_receipt.deposited_collateral = user_receipt.deposited_collateral
        .checked_add(amount)
        .ok_or(VeilLendError::MathOverflow)?;
    user_receipt.shares = user_receipt.shares
        .checked_add(shares)
        .ok_or(VeilLendError::MathOverflow)?;
    user_receipt.last_update_timestamp = clock.unix_timestamp;
    
    emit!(DepositEvent {
        vault: vault.key(),
        user: ctx.accounts.user.key(),
        amount,
        shares,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

#[event]
pub struct DepositEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub shares: u64,
    pub timestamp: i64,
}
