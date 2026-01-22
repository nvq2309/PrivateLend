use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use kamino_lend::cpi::{borrow_obligation_liquidity, refresh_obligation, refresh_reserve};
use kamino_lend::cpi::accounts::{
    BorrowObligationLiquidity,
    RefreshObligation,
    RefreshReserve,
};

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

    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        constraint = borrow_mint.key() == vault.borrow_mint
    )]
    pub borrow_mint: Box<Account<'info, Mint>>,
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

    let vault = &mut ctx.accounts.vault;
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

    vault.total_borrowed = vault
        .total_borrowed
        .checked_add(amount)
        .ok_or(VeilLendError::MathOverflow)?;
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
