use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};
use solana_program::hash::hash;

use crate::arcium::is_zero_pubkey;
use crate::constants::*;
use crate::errors::VeilLendError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(
    note_hash: [u8; 32],
    note_payload: Vec<u8>,
    amount: u64,
    encrypted_balance: [u8; 32],
    client_pubkey: [u8; 32],
)]
pub struct DepositNoteFast<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, collateral_mint.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + NoteReceipt::INIT_SPACE,
        seeds = [NOTE_RECEIPT_SEED, vault.key().as_ref(), note_hash.as_ref()],
        bump,
    )]
    pub note_receipt: Box<Account<'info, NoteReceipt>>,

    #[account(
        mut,
        constraint = receipt_mint.key() == vault.receipt_mint
    )]
    pub receipt_mint: Box<Account<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = user,
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
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn deposit_note_fast(
    ctx: Context<DepositNoteFast>,
    note_hash: [u8; 32],
    note_payload: Vec<u8>,
    amount: u64,
    encrypted_balance: [u8; 32],
    client_pubkey: [u8; 32],
) -> Result<()> {
    require!(!ctx.accounts.vault.is_paused, VeilLendError::VaultPaused);
    require!(amount > 0, VeilLendError::InsufficientCollateral);

    let derived_hash = hash(&note_payload).to_bytes();
    require!(derived_hash == note_hash, VeilLendError::InvalidNoteHash);

    let vault = &mut ctx.accounts.vault;
    let note_receipt = &mut ctx.accounts.note_receipt;

    if is_zero_pubkey(&client_pubkey) {
        return err!(VeilLendError::ArciumClientKeyMissing);
    }
    if !is_zero_pubkey(&note_receipt.client_pubkey) && note_receipt.client_pubkey != client_pubkey {
        return err!(VeilLendError::ArciumClientKeyMismatch);
    }

    let shares_to_mint = if vault.total_shares == 0 || vault.total_collateral == 0 {
        amount
    } else {
        let numerator = (amount as u128)
            .checked_mul(vault.total_shares as u128)
            .ok_or(VeilLendError::MathOverflow)?;
        (numerator
            .checked_div(vault.total_collateral as u128)
            .ok_or(VeilLendError::MathOverflow)?) as u64
    };
    require!(shares_to_mint > 0, VeilLendError::InsufficientCollateral);

    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_collateral_account.to_account_info(),
            to: ctx.accounts.vault_collateral_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, amount)?;

    let collateral_mint_key = ctx.accounts.collateral_mint.key();
    let bump = vault.bump;
    let seeds = &[VAULT_SEED, collateral_mint_key.as_ref(), &[bump]];
    let signer_seeds = &[&seeds[..]];

    let mint_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        MintTo {
            mint: ctx.accounts.receipt_mint.to_account_info(),
            to: ctx.accounts.note_receipt_token_account.to_account_info(),
            authority: vault.to_account_info(),
        },
        signer_seeds,
    );
    token::mint_to(mint_ctx, shares_to_mint)?;

    vault.total_collateral = vault
        .total_collateral
        .checked_add(amount)
        .ok_or(VeilLendError::MathOverflow)?;
    vault.total_shares = vault
        .total_shares
        .checked_add(shares_to_mint)
        .ok_or(VeilLendError::MathOverflow)?;

    if note_receipt.bump == 0 {
        note_receipt.bump = ctx.bumps.note_receipt;
    }
    if note_receipt.note_hash != [0u8; 32] && note_receipt.note_hash != note_hash {
        return err!(VeilLendError::InvalidNoteHash);
    }
    note_receipt.note_hash = note_hash;
    note_receipt.vault = vault.key();
    note_receipt.shares = note_receipt
        .shares
        .checked_add(shares_to_mint)
        .ok_or(VeilLendError::MathOverflow)?;
    note_receipt.deposited_collateral = note_receipt
        .deposited_collateral
        .checked_add(amount)
        .ok_or(VeilLendError::MathOverflow)?;
    note_receipt.encrypted_balance = encrypted_balance;
    note_receipt.last_update_timestamp = Clock::get()?.unix_timestamp;
    if is_zero_pubkey(&note_receipt.client_pubkey) {
        note_receipt.client_pubkey = client_pubkey;
    }

    emit!(DepositNoteFastEvent {
        vault: vault.key(),
        user: ctx.accounts.user.key(),
        amount,
        shares_minted: shares_to_mint,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct DepositNoteFastEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub shares_minted: u64,
    pub timestamp: i64,
}
