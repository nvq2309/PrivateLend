use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::*;
use crate::errors::VeilLendError;
use crate::state::*;

#[derive(Accounts)]
pub struct Borrow<'info> {
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
    pub user_borrow_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: validated via Kamino program
    pub kamino_market: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_obligation: AccountInfo<'info>,

    pub collateral_mint: Box<Account<'info, anchor_spl::token::Mint>>,
    #[account(constraint = borrow_mint.key() == vault.borrow_mint)]
    pub borrow_mint: Box<Account<'info, anchor_spl::token::Mint>>,
    pub token_program: Program<'info, Token>,

    /// CHECK: Kamino lending program
    pub kamino_program: AccountInfo<'info>,
}

pub fn borrow(
    ctx: Context<Borrow>,
    amount: u64,
    encrypted_balance: [u8; 32],
) -> Result<()> {
    require!(!ctx.accounts.vault.is_paused, VeilLendError::VaultPaused);
    require!(amount > 0, VeilLendError::InsufficientCollateral);

    let user_receipt = &mut ctx.accounts.user_receipt;

    let max_borrow = user_receipt
        .deposited_collateral
        .checked_mul(MAX_LTV_BPS)
        .ok_or(VeilLendError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(VeilLendError::MathOverflow)?;

    let new_total_borrow = user_receipt
        .borrowed_amount
        .checked_add(amount)
        .ok_or(VeilLendError::MathOverflow)?;

    require!(
        new_total_borrow <= max_borrow,
        VeilLendError::BorrowLimitExceeded
    );

    // TODO: Integrate Kamino CPI borrow flow

    user_receipt.borrowed_amount = new_total_borrow;
    user_receipt.encrypted_balance = encrypted_balance;

    emit!(BorrowEvent {
        vault: ctx.accounts.vault.key(),
        user: ctx.accounts.user.key(),
        amount,
        total_borrowed: new_total_borrow,
        timestamp: Clock::get()?.unix_timestamp,
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
