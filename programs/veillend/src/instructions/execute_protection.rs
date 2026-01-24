use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::VeilLendError;
use crate::state::*;

#[derive(Accounts)]
pub struct ExecuteProtection<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, collateral_mint.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    /// CHECK: Validated by PDA seeds in user_receipt
    pub protected_user: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [USER_RECEIPT_SEED, vault.key().as_ref(), protected_user.key().as_ref()],
        bump = user_receipt.bump,
        constraint = user_receipt.owner == protected_user.key() @ VeilLendError::Unauthorized,
    )]
    pub user_receipt: Box<Account<'info, UserReceipt>>,

    #[account(
        mut,
        seeds = [PROTECTION_POOL_SEED, vault.key().as_ref()],
        bump = protection_pool.bump,
    )]
    pub protection_pool: Box<Account<'info, ProtectionPool>>,

    #[account(
        mut,
        seeds = [PROTECTION_RESERVE_SEED, vault.key().as_ref()],
        bump,
    )]
    pub protection_reserve_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [VAULT_COLLATERAL_SEED, vault.key().as_ref()],
        bump,
    )]
    pub vault_collateral_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: Pyth oracle for price feed (validated in production)
    pub price_oracle: AccountInfo<'info>,

    pub collateral_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

pub fn execute_protection(ctx: Context<ExecuteProtection>) -> Result<()> {
    let user_receipt = &ctx.accounts.user_receipt;
    let protection_pool = &ctx.accounts.protection_pool;
    let clock = Clock::get()?;

    require!(
        user_receipt.protection_tier > 0,
        VeilLendError::NoProtection
    );
    require!(
        clock.unix_timestamp < user_receipt.protection_expiry,
        VeilLendError::ProtectionExpired
    );

    let collateral_value = user_receipt.deposited_collateral;
    let borrow_value = user_receipt.borrowed_amount;

    require!(borrow_value > 0, VeilLendError::NoDebt);

    let health_factor_bps = collateral_value
        .checked_mul(DEFAULT_LTV_BPS)
        .ok_or(VeilLendError::MathOverflow)?
        .checked_div(borrow_value)
        .ok_or(VeilLendError::MathOverflow)?;

    let mitigation_threshold = match user_receipt.protection_tier {
        1 => BASIC_TIER_THRESHOLD_BPS,
        2 => PREMIUM_TIER_THRESHOLD_BPS,
        _ => return Err(VeilLendError::InvalidProtectionTier.into()),
    };

    require!(
        health_factor_bps < mitigation_threshold,
        VeilLendError::HealthFactorSafe
    );

    let target_collateral = borrow_value
        .checked_mul(TARGET_HEALTH_FACTOR_BPS)
        .ok_or(VeilLendError::MathOverflow)?
        .checked_div(DEFAULT_LTV_BPS)
        .ok_or(VeilLendError::MathOverflow)?;

    let collateral_needed = target_collateral.saturating_sub(collateral_value);

    let max_coverage = match user_receipt.protection_tier {
        1 => collateral_value
            .checked_mul(BASIC_TIER_COVERAGE_BPS)
            .ok_or(VeilLendError::MathOverflow)?
            .checked_div(10000)
            .ok_or(VeilLendError::MathOverflow)?,
        2 => collateral_value
            .checked_mul(PREMIUM_TIER_COVERAGE_BPS)
            .ok_or(VeilLendError::MathOverflow)?
            .checked_div(10000)
            .ok_or(VeilLendError::MathOverflow)?,
        _ => 0,
    };

    let protection_amount = std::cmp::min(collateral_needed, max_coverage);

    require!(
        protection_pool.reserve_balance >= protection_amount,
        VeilLendError::InsufficientProtectionReserve
    );

    let vault_key = ctx.accounts.vault.key();
    let seeds = &[
        PROTECTION_RESERVE_SEED,
        vault_key.as_ref(),
        &[ctx.bumps.protection_reserve_account],
    ];
    let signer_seeds = &[&seeds[..]];

    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.protection_reserve_account.to_account_info(),
            to: ctx.accounts.vault_collateral_account.to_account_info(),
            authority: ctx.accounts.protection_reserve_account.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, protection_amount)?;

    let protection_pool = &mut ctx.accounts.protection_pool;
    protection_pool.reserve_balance = protection_pool
        .reserve_balance
        .checked_sub(protection_amount)
        .ok_or(VeilLendError::MathOverflow)?;
    protection_pool.total_coverage = protection_pool
        .total_coverage
        .saturating_sub(protection_amount);
    protection_pool.total_executions = protection_pool
        .total_executions
        .checked_add(1)
        .ok_or(VeilLendError::MathOverflow)?;
    protection_pool.total_protection_paid = protection_pool
        .total_protection_paid
        .checked_add(protection_amount)
        .ok_or(VeilLendError::MathOverflow)?;

    let user_receipt = &mut ctx.accounts.user_receipt;
    user_receipt.deposited_collateral = user_receipt
        .deposited_collateral
        .checked_add(protection_amount)
        .ok_or(VeilLendError::MathOverflow)?;
    user_receipt.last_update_timestamp = clock.unix_timestamp;

    let vault = &mut ctx.accounts.vault;
    vault.total_collateral = vault
        .total_collateral
        .checked_add(protection_amount)
        .ok_or(VeilLendError::MathOverflow)?;

    let new_health_factor = user_receipt
        .deposited_collateral
        .checked_mul(DEFAULT_LTV_BPS)
        .ok_or(VeilLendError::MathOverflow)?
        .checked_div(borrow_value)
        .ok_or(VeilLendError::MathOverflow)?;

    emit!(ProtectionExecutedEvent {
        vault: ctx.accounts.vault.key(),
        user: ctx.accounts.protected_user.key(),
        protection_amount,
        old_health_factor: health_factor_bps,
        new_health_factor,
        caller: ctx.accounts.caller.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct ProtectionExecutedEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub protection_amount: u64,
    pub old_health_factor: u64,
    pub new_health_factor: u64,
    pub caller: Pubkey,
    pub timestamp: i64,
}
