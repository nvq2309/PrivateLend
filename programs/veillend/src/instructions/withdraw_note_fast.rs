use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};
use solana_program::hash::hash;

use crate::arcium::is_zero_pubkey;
use crate::constants::*;
use crate::errors::VeilLendError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(
    note_hash: [u8; 32],
    note_payload: Vec<u8>,
    shares_to_burn: u64,
    encrypted_balance: [u8; 32],
)]
pub struct WithdrawNoteFast<'info> {
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
        seeds = [NOTE_RECEIPT_SEED, vault.key().as_ref(), note_hash.as_ref()],
        bump = note_receipt.bump,
    )]
    pub note_receipt: Box<Account<'info, NoteReceipt>>,

    #[account(
        mut,
        constraint = receipt_mint.key() == vault.receipt_mint
    )]
    pub receipt_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = receipt_mint,
        associated_token::authority = note_receipt,
    )]
    pub note_receipt_token_account: Box<Account<'info, TokenAccount>>,

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

pub fn withdraw_note_fast(
    ctx: Context<WithdrawNoteFast>,
    note_hash: [u8; 32],
    note_payload: Vec<u8>,
    shares_to_burn: u64,
    encrypted_balance: [u8; 32],
) -> Result<()> {
    require!(shares_to_burn > 0, VeilLendError::InsufficientShares);

    let derived_hash = hash(&note_payload).to_bytes();
    require!(derived_hash == note_hash, VeilLendError::InvalidNoteHash);

    if is_zero_pubkey(&ctx.accounts.note_receipt.client_pubkey) {
        return err!(VeilLendError::ArciumClientKeyMissing);
    }
    require!(
        ctx.accounts.note_receipt.note_hash == note_hash,
        VeilLendError::InvalidNoteHash
    );

    require!(
        ctx.accounts.note_receipt.shares >= shares_to_burn,
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
        ctx.accounts.note_receipt.deposited_collateral >= collateral_to_return,
        VeilLendError::InsufficientCollateral
    );

    let remaining_collateral = ctx
        .accounts
        .note_receipt
        .deposited_collateral
        .checked_sub(collateral_to_return)
        .ok_or(VeilLendError::MathOverflow)?;

    if ctx.accounts.note_receipt.borrowed_amount > 0 {
        let ltv_bps = ctx.accounts.vault.ltv_bps.min(MAX_LTV_BPS);
        let max_borrow_allowed = (remaining_collateral as u128)
            .checked_mul(ltv_bps as u128)
            .ok_or(VeilLendError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR as u128)
            .ok_or(VeilLendError::MathOverflow)? as u64;

        require!(
            ctx.accounts.note_receipt.borrowed_amount <= max_borrow_allowed,
            VeilLendError::BorrowLimitExceeded
        );
    }

    let vault_key = ctx.accounts.vault.key();
    let note_seeds = &[
        NOTE_RECEIPT_SEED,
        vault_key.as_ref(),
        note_hash.as_ref(),
        &[ctx.accounts.note_receipt.bump],
    ];
    let note_signer_seeds = &[&note_seeds[..]];
    let burn_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Burn {
            mint: ctx.accounts.receipt_mint.to_account_info(),
            from: ctx.accounts.note_receipt_token_account.to_account_info(),
            authority: ctx.accounts.note_receipt.to_account_info(),
        },
        note_signer_seeds,
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

    let note_receipt = &mut ctx.accounts.note_receipt;
    note_receipt.shares = note_receipt
        .shares
        .checked_sub(shares_to_burn)
        .ok_or(VeilLendError::MathOverflow)?;
    note_receipt.deposited_collateral = note_receipt
        .deposited_collateral
        .checked_sub(collateral_to_return)
        .ok_or(VeilLendError::MathOverflow)?;
    note_receipt.encrypted_balance = encrypted_balance;
    note_receipt.last_update_timestamp = Clock::get()?.unix_timestamp;

    emit!(WithdrawNoteFastEvent {
        vault: ctx.accounts.vault.key(),
        user: ctx.accounts.user.key(),
        shares_burned: shares_to_burn,
        collateral_returned: collateral_to_return,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct WithdrawNoteFastEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub shares_burned: u64,
    pub collateral_returned: u64,
    pub timestamp: i64,
}
