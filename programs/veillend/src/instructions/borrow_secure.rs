use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use kamino_lend::cpi::accounts::{BorrowObligationLiquidity, RefreshObligation, RefreshReserve};
use kamino_lend::cpi::{borrow_obligation_liquidity, refresh_obligation, refresh_reserve};

use crate::arcium::is_zero_pubkey;
use crate::constants::*;
use crate::errors::VeilLendError;
use crate::merkle::{append_leaf, verify_merkle_proof};
use crate::state::*;

#[derive(Accounts)]
#[instruction(
    amount: u64,
    encrypted_balance: [u8; 32],
    current_commitment: [u8; 32],
    new_commitment: [u8; 32],
    nullifier: [u8; 32],
    note_hash: [u8; 32],
)]
pub struct BorrowSecure<'info> {
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
    pub user_borrow_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: validated via Kamino program
    pub kamino_market: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_obligation: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_lending_market_authority: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_borrow_reserve: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_borrow_reserve_liquidity_mint: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_reserve_source_liquidity: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_borrow_reserve_liquidity_fee_receiver: AccountInfo<'info>,

    /// CHECK: validated via Kamino program
    pub kamino_referrer_token_state: AccountInfo<'info>,

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

    #[account(
        mut,
        seeds = [MERKLE_TREE_SEED, vault.key().as_ref()],
        bump = merkle_tree.bump,
    )]
    pub merkle_tree: Box<Account<'info, MerkleTree>>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Nullifier::INIT_SPACE,
        seeds = [NULLIFIER_SEED, vault.key().as_ref(), nullifier.as_ref()],
        bump,
    )]
    pub nullifier_account: Box<Account<'info, Nullifier>>,

    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        constraint = borrow_mint.key() == vault.borrow_mint
    )]
    pub borrow_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,

    /// CHECK: Kamino lending program
    pub kamino_program: AccountInfo<'info>,
}

pub fn borrow_secure(
    ctx: Context<BorrowSecure>,
    amount: u64,
    encrypted_balance: [u8; 32],
    current_commitment: [u8; 32],
    new_commitment: [u8; 32],
    nullifier: [u8; 32],
    note_hash: [u8; 32],
    merkle_proof: Vec<[u8; 32]>,
    merkle_path: Vec<u8>,
) -> Result<()> {
    msg!("Nullifier bytes: {:?}", nullifier);
    require!(!ctx.accounts.vault.is_paused, VeilLendError::VaultPaused);
    require!(amount > 0, VeilLendError::InsufficientCollateral);

    let vault = &mut ctx.accounts.vault;
    let note_receipt = &mut ctx.accounts.note_receipt;

    if is_zero_pubkey(&note_receipt.client_pubkey) {
        return err!(VeilLendError::ArciumClientKeyMissing);
    }
    if note_receipt.note_hash != note_hash {
        return err!(VeilLendError::InvalidNoteHash);
    }

    let ltv_bps = vault.ltv_bps.min(MAX_LTV_BPS);
    let max_borrow = note_receipt
        .deposited_collateral
        .checked_mul(ltv_bps)
        .ok_or(VeilLendError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(VeilLendError::MathOverflow)?;

    let new_total_borrow = note_receipt
        .borrowed_amount
        .checked_add(amount)
        .ok_or(VeilLendError::MathOverflow)?;

    require!(
        new_total_borrow <= max_borrow,
        VeilLendError::BorrowLimitExceeded
    );

    require!(
        ctx.accounts.merkle_tree.vault == vault.key(),
        VeilLendError::InvalidVaultState
    );
    verify_merkle_proof(
        current_commitment,
        ctx.accounts.merkle_tree.root,
        &merkle_proof,
        &merkle_path,
    )?;
    if ctx.accounts.nullifier_account.spent {
        return err!(VeilLendError::NullifierAlreadySpent);
    }

    if ctx.accounts.kamino_program.key() != Pubkey::default() {
        let refresh_reserve_ctx = CpiContext::new(
            ctx.accounts.kamino_program.to_account_info(),
            RefreshReserve {
                reserve: ctx.accounts.kamino_borrow_reserve.to_account_info(),
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

        let borrow_ctx = CpiContext::new(
            ctx.accounts.kamino_program.to_account_info(),
            BorrowObligationLiquidity {
                owner: ctx.accounts.user.to_account_info(),
                obligation: ctx.accounts.kamino_obligation.to_account_info(),
                lending_market: ctx.accounts.kamino_market.to_account_info(),
                lending_market_authority: ctx
                    .accounts
                    .kamino_lending_market_authority
                    .to_account_info(),
                borrow_reserve: ctx.accounts.kamino_borrow_reserve.to_account_info(),
                borrow_reserve_liquidity_mint: ctx
                    .accounts
                    .kamino_borrow_reserve_liquidity_mint
                    .to_account_info(),
                reserve_source_liquidity: ctx
                    .accounts
                    .kamino_reserve_source_liquidity
                    .to_account_info(),
                borrow_reserve_liquidity_fee_receiver: ctx
                    .accounts
                    .kamino_borrow_reserve_liquidity_fee_receiver
                    .to_account_info(),
                user_destination_liquidity: ctx.accounts.user_borrow_account.to_account_info(),
                referrer_token_state: ctx.accounts.kamino_referrer_token_state.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                instruction_sysvar_account: ctx
                    .accounts
                    .kamino_instruction_sysvar_account
                    .to_account_info(),
            },
        );
        borrow_obligation_liquidity(borrow_ctx, amount)?;
    } else {
        let collateral_mint_key = ctx.accounts.collateral_mint.key();
        let bump = vault.bump;
        let seeds = &[VAULT_SEED, collateral_mint_key.as_ref(), &[bump]];
        let signer_seeds = &[&seeds[..]];

        let mint_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.borrow_mint.to_account_info(),
                to: ctx.accounts.user_borrow_account.to_account_info(),
                authority: vault.to_account_info(),
            },
            signer_seeds,
        );
        token::mint_to(mint_ctx, amount)?;
    }

    ctx.accounts.nullifier_account.vault = vault.key();
    ctx.accounts.nullifier_account.spent = true;
    ctx.accounts.nullifier_account.bump = ctx.bumps.nullifier_account;

    let leaf_index = append_leaf(&mut ctx.accounts.merkle_tree, new_commitment)?;

    vault.total_borrowed = vault
        .total_borrowed
        .checked_add(amount)
        .ok_or(VeilLendError::MathOverflow)?;
    note_receipt.borrowed_amount = new_total_borrow;
    note_receipt.encrypted_balance = encrypted_balance;

    emit!(BorrowSecureEvent {
        vault: vault.key(),
        user: ctx.accounts.user.key(),
        amount,
        total_borrowed: new_total_borrow,
        current_commitment,
        new_commitment,
        nullifier,
        leaf_index,
        merkle_root: ctx.accounts.merkle_tree.root,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct BorrowSecureEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub total_borrowed: u64,
    pub current_commitment: [u8; 32],
    pub new_commitment: [u8; 32],
    pub nullifier: [u8; 32],
    pub leaf_index: u32,
    pub merkle_root: [u8; 32],
    pub timestamp: i64,
}
