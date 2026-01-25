use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount};
use kamino_lend::cpi::accounts::{RefreshObligation, RefreshReserve, RepayObligationLiquidity};
use kamino_lend::cpi::{refresh_obligation, refresh_reserve, repay_obligation_liquidity};

use crate::arcium::is_zero_pubkey;
use crate::constants::*;
use crate::errors::VeilLendError;
use crate::merkle::{append_leaf, verify_merkle_proof};
use crate::state::*;
use crate::zk_verifier::{poseidon_nullifier_hash, verify_groth16_proof, Groth16Proof, ZkAction};

#[derive(Accounts)]
#[instruction(
    amount: u64,
    encrypted_balance: [u8; 32],
    current_commitment: [u8; 32],
    new_commitment: [u8; 32],
    nullifier: [u8; 32],
    proof: Groth16Proof,
    merkle_proof: Vec<[u8; 32]>,
    merkle_path: Vec<u8>,
)]
pub struct RepaySecure<'info> {
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
        seeds = [NOTE_RECEIPT_SEED, vault.key().as_ref(), note_receipt.note_hash.as_ref()],
        bump = note_receipt.bump,
    )]
    pub note_receipt: Box<Account<'info, NoteReceipt>>,

    #[account(mut)]
    pub user_repay_account: Box<Account<'info, TokenAccount>>,

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
        constraint = repay_mint.key() == vault.borrow_mint
    )]
    pub repay_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn repay_secure<'info>(
    ctx: Context<'_, '_, '_, 'info, RepaySecure<'info>>,
    amount: u64,
    encrypted_balance: [u8; 32],
    current_commitment: [u8; 32],
    new_commitment: [u8; 32],
    nullifier: [u8; 32],
    proof: Groth16Proof,
    merkle_proof: Vec<[u8; 32]>,
    merkle_path: Vec<u8>,
) -> Result<()> {
    msg!("Nullifier bytes: {:?}", nullifier);
    require!(amount > 0, VeilLendError::InsufficientCollateral);

    let vault = &mut ctx.accounts.vault;
    let note_receipt = &mut ctx.accounts.note_receipt;
    let repay_amount = amount.min(note_receipt.borrowed_amount);
    require!(repay_amount > 0, VeilLendError::InsufficientCollateral);

    if is_zero_pubkey(&note_receipt.client_pubkey) {
        return err!(VeilLendError::ArciumClientKeyMissing);
    }

    let nullifier_hash = poseidon_nullifier_hash(&nullifier)?;
    let public_inputs = [
        ctx.accounts.merkle_tree.root,
        nullifier_hash,
        current_commitment,
        new_commitment,
    ];
    verify_groth16_proof(ZkAction::Repay, &proof, &public_inputs)?;

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

    if !ctx.remaining_accounts.is_empty() {
        let kamino_market = &ctx.remaining_accounts[0];
        let kamino_obligation = &ctx.remaining_accounts[1];
        let kamino_repay_reserve = &ctx.remaining_accounts[2];
        let kamino_reserve_liquidity_mint = &ctx.remaining_accounts[3];
        let kamino_reserve_destination_liquidity = &ctx.remaining_accounts[4];
        let kamino_instruction_sysvar_account = &ctx.remaining_accounts[5];
        let kamino_pyth_oracle = &ctx.remaining_accounts[6];
        let kamino_switchboard_price_oracle = &ctx.remaining_accounts[7];
        let kamino_switchboard_twap_oracle = &ctx.remaining_accounts[8];
        let kamino_scope_prices = &ctx.remaining_accounts[9];
        let kamino_program = &ctx.remaining_accounts[10];

        let refresh_reserve_ctx = CpiContext::new(
            kamino_program.to_account_info(),
            RefreshReserve {
                reserve: kamino_repay_reserve.to_account_info(),
                lending_market: kamino_market.to_account_info(),
                pyth_oracle: kamino_pyth_oracle.to_account_info(),
                switchboard_price_oracle: kamino_switchboard_price_oracle.to_account_info(),
                switchboard_twap_oracle: kamino_switchboard_twap_oracle.to_account_info(),
                scope_prices: kamino_scope_prices.to_account_info(),
            },
        );
        refresh_reserve(refresh_reserve_ctx)?;

        let refresh_obligation_ctx = CpiContext::new(
            kamino_program.to_account_info(),
            RefreshObligation {
                lending_market: kamino_market.to_account_info(),
                obligation: kamino_obligation.to_account_info(),
            },
        );
        refresh_obligation(refresh_obligation_ctx)?;

        let repay_ctx = CpiContext::new(
            kamino_program.to_account_info(),
            RepayObligationLiquidity {
                owner: ctx.accounts.user.to_account_info(),
                obligation: kamino_obligation.to_account_info(),
                lending_market: kamino_market.to_account_info(),
                repay_reserve: kamino_repay_reserve.to_account_info(),
                reserve_liquidity_mint: kamino_reserve_liquidity_mint.to_account_info(),
                reserve_destination_liquidity: kamino_reserve_destination_liquidity
                    .to_account_info(),
                user_source_liquidity: ctx.accounts.user_repay_account.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                instruction_sysvar_account: kamino_instruction_sysvar_account.to_account_info(),
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

    ctx.accounts.nullifier_account.vault = vault.key();
    ctx.accounts.nullifier_account.spent = true;
    ctx.accounts.nullifier_account.bump = ctx.bumps.nullifier_account;

    let leaf_index = append_leaf(&mut ctx.accounts.merkle_tree, new_commitment)?;

    vault.total_borrowed = vault
        .total_borrowed
        .checked_sub(repay_amount)
        .ok_or(VeilLendError::MathOverflow)?;
    note_receipt.borrowed_amount = note_receipt
        .borrowed_amount
        .checked_sub(repay_amount)
        .ok_or(VeilLendError::MathOverflow)?;
    note_receipt.encrypted_balance = encrypted_balance;

    emit!(RepaySecureEvent {
        vault: vault.key(),
        user: ctx.accounts.user.key(),
        amount: repay_amount,
        remaining_debt: note_receipt.borrowed_amount,
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
pub struct RepaySecureEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub remaining_debt: u64,
    pub current_commitment: [u8; 32],
    pub new_commitment: [u8; 32],
    pub nullifier: [u8; 32],
    pub leaf_index: u32,
    pub merkle_root: [u8; 32],
    pub timestamp: i64,
}
