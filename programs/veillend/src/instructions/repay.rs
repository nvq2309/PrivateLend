use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::VeilLendError;
use crate::state::*;

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, collateral_mint.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        mut,
        seeds = [USER_RECEIPT_SEED, vault.key().as_ref(), user.key().as_ref()],
        bump = user_receipt.bump,
        constraint = user_receipt.owner == user.key(),
    )]
    pub user_receipt: Box<Account<'info, UserReceipt>>,

    #[account(mut)]
    pub user_repay_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub vault_repay_account: Box<Account<'info, TokenAccount>>,

    pub collateral_mint: Box<Account<'info, anchor_spl::token::Mint>>,
    #[account(constraint = repay_mint.key() == vault.borrow_mint)]
    pub repay_mint: Box<Account<'info, anchor_spl::token::Mint>>,
    pub token_program: Program<'info, Token>,
}

pub fn repay(
    ctx: Context<Repay>,
    amount: u64,
    encrypted_balance: [u8; 32],
) -> Result<()> {
    require!(amount > 0, VeilLendError::InsufficientCollateral);

    let user_receipt = &mut ctx.accounts.user_receipt;
    let repay_amount = amount.min(user_receipt.borrowed_amount);
    require!(repay_amount > 0, VeilLendError::InsufficientCollateral);

    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_repay_account.to_account_info(),
            to: ctx.accounts.vault_repay_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, repay_amount)?;

    user_receipt.borrowed_amount = user_receipt
        .borrowed_amount
        .checked_sub(repay_amount)
        .ok_or(VeilLendError::MathOverflow)?;
    user_receipt.encrypted_balance = encrypted_balance;

    emit!(RepayEvent {
        vault: ctx.accounts.vault.key(),
        user: ctx.accounts.user.key(),
        amount: repay_amount,
        remaining_debt: user_receipt.borrowed_amount,
        timestamp: Clock::get()?.unix_timestamp,
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
