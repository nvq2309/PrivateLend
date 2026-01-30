use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::arcium::is_zero_pubkey;
use crate::constants::*;
use crate::errors::VeilLendError;
use crate::merkle::{append_leaf, initialize_merkle_tree as init_tree};
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(
    note_hash: [u8; 32],
    commitment: [u8; 32],
)]
pub struct ShieldPosition<'info> {
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
        constraint = user_receipt.owner == user.key() @ VeilLendError::Unauthorized,
    )]
    pub user_receipt: Box<Account<'info, UserReceipt>>,

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
        constraint = receipt_mint.key() == vault.receipt_mint,
    )]
    pub receipt_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        constraint = user_receipt_token_account.mint == receipt_mint.key(),
        constraint = user_receipt_token_account.owner == user.key(),
    )]
    pub user_receipt_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = receipt_mint,
        associated_token::authority = note_receipt,
    )]
    pub note_receipt_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + MerkleTree::INIT_SPACE,
        seeds = [MERKLE_TREE_SEED, vault.key().as_ref()],
        bump,
    )]
    pub merkle_tree: Box<Account<'info, MerkleTree>>,

    pub collateral_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn shield_position(
    ctx: Context<ShieldPosition>,
    note_hash: [u8; 32],
    commitment: [u8; 32],
) -> Result<()> {
    require!(!ctx.accounts.vault.is_paused, VeilLendError::VaultPaused);

    let user_receipt = &mut ctx.accounts.user_receipt;
    let shares_to_move = user_receipt.shares;
    let deposit_to_move = user_receipt.deposited_collateral;
    let borrow_to_move = user_receipt.borrowed_amount;

    require!(
        shares_to_move > 0 || deposit_to_move > 0 || borrow_to_move > 0,
        VeilLendError::NoFastPosition
    );

    let merkle_tree = &mut ctx.accounts.merkle_tree;
    if merkle_tree.depth == 0 {
        merkle_tree.vault = ctx.accounts.vault.key();
        merkle_tree.bump = ctx.bumps.merkle_tree;
        init_tree(merkle_tree)?;
    }
    require!(
        merkle_tree.vault == ctx.accounts.vault.key(),
        VeilLendError::InvalidVaultState
    );

    if shares_to_move > 0 {
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_receipt_token_account.to_account_info(),
                to: ctx.accounts.note_receipt_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, shares_to_move)?;
    }

    let note_receipt = &mut ctx.accounts.note_receipt;
    if !is_zero_pubkey(&note_receipt.client_pubkey)
        && note_receipt.client_pubkey != user_receipt.client_pubkey
    {
        return err!(VeilLendError::ArciumClientKeyMismatch);
    }
    if note_receipt.bump == 0 {
        note_receipt.bump = ctx.bumps.note_receipt;
        note_receipt.last_update_timestamp = Clock::get()?.unix_timestamp;
    }
    if note_receipt.note_hash != [0u8; 32] && note_receipt.note_hash != note_hash {
        return err!(VeilLendError::InvalidNoteHash);
    }
    note_receipt.note_hash = note_hash;
    note_receipt.vault = ctx.accounts.vault.key();
    note_receipt.shares = note_receipt
        .shares
        .checked_add(shares_to_move)
        .ok_or(VeilLendError::MathOverflow)?;
    note_receipt.deposited_collateral = note_receipt
        .deposited_collateral
        .checked_add(deposit_to_move)
        .ok_or(VeilLendError::MathOverflow)?;
    note_receipt.borrowed_amount = note_receipt
        .borrowed_amount
        .checked_add(borrow_to_move)
        .ok_or(VeilLendError::MathOverflow)?;
    note_receipt.encrypted_balance = user_receipt.encrypted_balance;
    if is_zero_pubkey(&note_receipt.client_pubkey) {
        note_receipt.client_pubkey = user_receipt.client_pubkey;
    }

    user_receipt.shares = 0;
    user_receipt.deposited_collateral = 0;
    user_receipt.borrowed_amount = 0;
    user_receipt.encrypted_balance = [0u8; 32];

    let leaf_index = append_leaf(merkle_tree, commitment)?;

    emit!(ShieldedPositionEvent {
        vault: ctx.accounts.vault.key(),
        user: ctx.accounts.user.key(),
        shares_migrated: shares_to_move,
        deposited_collateral: deposit_to_move,
        borrowed_amount: borrow_to_move,
        commitment,
        leaf_index,
        merkle_root: merkle_tree.root,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct ShieldedPositionEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub shares_migrated: u64,
    pub deposited_collateral: u64,
    pub borrowed_amount: u64,
    pub commitment: [u8; 32],
    pub leaf_index: u32,
    pub merkle_root: [u8; 32],
    pub timestamp: i64,
}
