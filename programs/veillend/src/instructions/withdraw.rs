use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::arcium::is_zero_pubkey;
use crate::constants::*;
use crate::errors::VeilLendError;
use crate::state::*;

#[derive(Accounts)]
pub struct Withdraw<'info> {
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

    #[account(
        mut,
        constraint = receipt_mint.key() == vault.receipt_mint
    )]
    pub receipt_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = receipt_mint,
        associated_token::authority = user,
    )]
    pub user_receipt_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_collateral_account.mint == vault.collateral_mint
    )]
    pub user_collateral_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [VAULT_COLLATERAL_SEED, vault.key().as_ref()],
        bump,
    )]
    pub vault_collateral_account: Box<Account<'info, TokenAccount>>,

    pub collateral_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn withdraw(
    ctx: Context<Withdraw>,
    shares_to_burn: u64,
    encrypted_balance: [u8; 32],
) -> Result<()> {
    require!(shares_to_burn > 0, VeilLendError::InsufficientShares);

    if is_zero_pubkey(&ctx.accounts.user_receipt.client_pubkey) {
        return err!(VeilLendError::ArciumClientKeyMissing);
    }

    require!(
        ctx.accounts.user_receipt.shares >= shares_to_burn,
        VeilLendError::InsufficientShares
    );

    require!(
        ctx.accounts.vault.total_shares > 0,
        VeilLendError::InsufficientShares
    );

    let collateral_to_return = (shares_to_burn as u128)
        .checked_mul(ctx.accounts.vault.total_collateral as u128)
        .ok_or(VeilLendError::MathOverflow)?
        .checked_div(ctx.accounts.vault.total_shares as u128)
        .ok_or(VeilLendError::MathOverflow)? as u64;

    require!(
        ctx.accounts.user_receipt.deposited_collateral >= collateral_to_return,
        VeilLendError::InsufficientCollateral
    );

    // LTV-based withdrawal validation
    // Allow withdrawal if remaining collateral maintains healthy LTV ratio
    let remaining_collateral = ctx.accounts.user_receipt.deposited_collateral
        .checked_sub(collateral_to_return)
        .ok_or(VeilLendError::MathOverflow)?;

    if ctx.accounts.user_receipt.borrowed_amount > 0 {
        let ltv_bps = ctx.accounts.vault.ltv_bps.min(MAX_LTV_BPS);
        let max_borrow_allowed = (remaining_collateral as u128)
            .checked_mul(ltv_bps as u128)
            .ok_or(VeilLendError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR as u128)
            .ok_or(VeilLendError::MathOverflow)? as u64;

        require!(
            ctx.accounts.user_receipt.borrowed_amount <= max_borrow_allowed,
            VeilLendError::BorrowLimitExceeded
        );
    }

    let burn_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Burn {
            mint: ctx.accounts.receipt_mint.to_account_info(),
            from: ctx.accounts.user_receipt_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::burn(burn_ctx, shares_to_burn)?;

    let collateral_mint_key = ctx.accounts.collateral_mint.key();
    let bump = ctx.accounts.vault.bump;
    let seeds = &[VAULT_SEED, collateral_mint_key.as_ref(), &[bump]];
    let signer_seeds = &[&seeds[..]];

    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault_collateral_account.to_account_info(),
            to: ctx.accounts.user_collateral_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, collateral_to_return)?;

    let vault = &mut ctx.accounts.vault;
    vault.total_collateral = vault
        .total_collateral
        .checked_sub(collateral_to_return)
        .ok_or(VeilLendError::MathOverflow)?;
    vault.total_shares = vault
        .total_shares
        .checked_sub(shares_to_burn)
        .ok_or(VeilLendError::MathOverflow)?;

    let user_receipt = &mut ctx.accounts.user_receipt;
    user_receipt.shares = user_receipt
        .shares
        .checked_sub(shares_to_burn)
        .ok_or(VeilLendError::MathOverflow)?;
    user_receipt.deposited_collateral = user_receipt
        .deposited_collateral
        .checked_sub(collateral_to_return)
        .ok_or(VeilLendError::MathOverflow)?;
    user_receipt.encrypted_balance = encrypted_balance;

    emit!(WithdrawEvent {
        vault: vault.key(),
        user: ctx.accounts.user.key(),
        shares_burned: shares_to_burn,
        collateral_returned: collateral_to_return,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct WithdrawEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub shares_burned: u64,
    pub collateral_returned: u64,
    pub timestamp: i64,
}
