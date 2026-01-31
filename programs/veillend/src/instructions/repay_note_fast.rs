use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount};
use kamino_lend::cpi::accounts::{RefreshObligation, RefreshReserve, RepayObligationLiquidity};
use kamino_lend::cpi::{refresh_obligation, refresh_reserve, repay_obligation_liquidity};
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
)]
pub struct RepayNoteFast<'info> {
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

    #[account(mut)]
    pub user_repay_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: validated via Kamino program
    pub kamino_market: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_obligation: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_repay_reserve: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_reserve_liquidity_mint: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_reserve_destination_liquidity: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_instruction_sysvar_account: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_pyth_oracle: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_switchboard_price_oracle: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_switchboard_twap_oracle: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_scope_prices: AccountInfo<'info>,

    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        constraint = repay_mint.key() == vault.borrow_mint
    )]
    pub repay_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,

    /// CHECK: Kamino lending program
    pub kamino_program: AccountInfo<'info>,
}

pub fn repay_note_fast(
    ctx: Context<RepayNoteFast>,
    note_hash: [u8; 32],
    note_payload: Vec<u8>,
    amount: u64,
    encrypted_balance: [u8; 32],
) -> Result<()> {
    require!(amount > 0, VeilLendError::InsufficientCollateral);

    let derived_hash = hash(&note_payload).to_bytes();
    require!(derived_hash == note_hash, VeilLendError::InvalidNoteHash);

    let vault = &mut ctx.accounts.vault;
    let note_receipt = &mut ctx.accounts.note_receipt;

    if is_zero_pubkey(&note_receipt.client_pubkey) {
        return err!(VeilLendError::ArciumClientKeyMissing);
    }
    require!(
        note_receipt.note_hash == note_hash,
        VeilLendError::InvalidNoteHash
    );

    let repay_amount = amount;
    let principal_reduction = amount.min(note_receipt.borrowed_amount);

    if ctx.accounts.kamino_program.key() != Pubkey::default() {
        let refresh_reserve_ctx = CpiContext::new(
            ctx.accounts.kamino_program.to_account_info(),
            RefreshReserve {
                reserve: ctx.accounts.kamino_repay_reserve.to_account_info(),
                lending_market: ctx.accounts.kamino_market.to_account_info(),
                pyth_oracle: ctx.accounts.kamino_pyth_oracle.to_account_info(),
                switchboard_price_oracle: ctx
                    .accounts
                    .kamino_switchboard_price_oracle
                    .to_account_info(),
                switchboard_twap_oracle: ctx
                    .accounts
                    .kamino_switchboard_twap_oracle
                    .to_account_info(),
                scope_prices: ctx.accounts.kamino_scope_prices.to_account_info(),
            },
        );
        refresh_reserve(refresh_reserve_ctx)?;

        let refresh_obligation_ctx = CpiContext::new(
            ctx.accounts.kamino_program.to_account_info(),
            RefreshObligation {
                lending_market: ctx.accounts.kamino_market.to_account_info(),
                obligation: ctx.accounts.kamino_obligation.to_account_info(),
            },
        );
        refresh_obligation(refresh_obligation_ctx)?;

        let repay_ctx = CpiContext::new(
            ctx.accounts.kamino_program.to_account_info(),
            RepayObligationLiquidity {
                owner: ctx.accounts.user.to_account_info(),
                obligation: ctx.accounts.kamino_obligation.to_account_info(),
                lending_market: ctx.accounts.kamino_market.to_account_info(),
                repay_reserve: ctx.accounts.kamino_repay_reserve.to_account_info(),
                reserve_liquidity_mint: ctx
                    .accounts
                    .kamino_reserve_liquidity_mint
                    .to_account_info(),
                reserve_destination_liquidity: ctx
                    .accounts
                    .kamino_reserve_destination_liquidity
                    .to_account_info(),
                user_source_liquidity: ctx.accounts.user_repay_account.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                instruction_sysvar_account: ctx
                    .accounts
                    .kamino_instruction_sysvar_account
                    .to_account_info(),
            },
        );
        repay_obligation_liquidity(repay_ctx, repay_amount)?;
    } else {
        let burn_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.repay_mint.to_account_info(),
                from: ctx.accounts.user_repay_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::burn(burn_ctx, repay_amount)?;
    }

    vault.total_borrowed = vault
        .total_borrowed
        .checked_sub(principal_reduction)
        .ok_or(VeilLendError::MathOverflow)?;
    note_receipt.borrowed_amount = note_receipt
        .borrowed_amount
        .checked_sub(principal_reduction)
        .ok_or(VeilLendError::MathOverflow)?;
    note_receipt.encrypted_balance = encrypted_balance;
    note_receipt.last_update_timestamp = Clock::get()?.unix_timestamp;

    emit!(RepayNoteFastEvent {
        vault: ctx.accounts.vault.key(),
        user: ctx.accounts.user.key(),
        amount: repay_amount,
        remaining_debt: note_receipt.borrowed_amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct RepayNoteFastEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub remaining_debt: u64,
    pub timestamp: i64,
}
