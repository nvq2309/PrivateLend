use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::VeilLendError;
use crate::merkle::{append_leaf, spend_note};
use crate::state::*;

#[derive(Accounts)]
#[instruction(
    amount: u64,
    encrypted_balance: [u8; 32],
    current_commitment: [u8; 32],
    new_commitment: [u8; 32],
    nullifier: [u8; 32],
)]
pub struct DepositSecureSpend<'info> {
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
        init_if_needed,
        payer = user,
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
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Secure deposit that spends an existing note and appends a new commitment.
pub fn deposit_secure_spend(
    ctx: Context<DepositSecureSpend>,
    amount: u64,
    encrypted_balance: [u8; 32],
    current_commitment: [u8; 32],
    new_commitment: [u8; 32],
    nullifier: [u8; 32],
    merkle_proof: Vec<[u8; 32]>,
    merkle_path: Vec<u8>,
) -> Result<()> {
    require!(!ctx.accounts.vault.is_paused, VeilLendError::VaultPaused);
    require!(amount > 0, VeilLendError::InsufficientCollateral);

    let vault = &mut ctx.accounts.vault;
    let user_receipt = &mut ctx.accounts.user_receipt;

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
            to: ctx.accounts.user_receipt_token_account.to_account_info(),
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

    user_receipt.shares = user_receipt
        .shares
        .checked_add(shares_to_mint)
        .ok_or(VeilLendError::MathOverflow)?;
    user_receipt.deposited_collateral = user_receipt
        .deposited_collateral
        .checked_add(amount)
        .ok_or(VeilLendError::MathOverflow)?;
    user_receipt.encrypted_balance = encrypted_balance;

    require!(
        ctx.accounts.merkle_tree.vault == vault.key(),
        VeilLendError::InvalidVaultState
    );
    spend_note(
        &ctx.accounts.merkle_tree,
        &mut ctx.accounts.nullifier_account,
        vault.key(),
        current_commitment,
        &merkle_proof,
        &merkle_path,
    )?;
    let leaf_index = append_leaf(&mut ctx.accounts.merkle_tree, new_commitment)?;

    emit!(DepositSecureSpendEvent {
        vault: vault.key(),
        user: ctx.accounts.user.key(),
        amount,
        shares_minted: shares_to_mint,
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
pub struct DepositSecureSpendEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub shares_minted: u64,
    pub current_commitment: [u8; 32],
    pub new_commitment: [u8; 32],
    pub nullifier: [u8; 32],
    pub leaf_index: u32,
    pub merkle_root: [u8; 32],
    pub timestamp: i64,
}
