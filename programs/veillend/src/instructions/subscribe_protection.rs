use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};

use crate::state::*;
use crate::errors::VeilLendError;
use crate::constants::*;

#[derive(Accounts)]
pub struct SubscribeProtection<'info> {
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
        mut,
        seeds = [PROTECTION_POOL_SEED, vault.key().as_ref()],
        bump = protection_pool.bump,
    )]
    pub protection_pool: Box<Account<'info, ProtectionPool>>,
    
    #[account(
        mut,
        constraint = user_payment_account.owner == user.key() @ VeilLendError::Unauthorized,
        constraint = user_payment_account.mint == collateral_mint.key(),
    )]
    pub user_payment_account: Box<Account<'info, TokenAccount>>,
    
    #[account(
        mut,
        seeds = [PROTECTION_RESERVE_SEED, vault.key().as_ref()],
        bump,
    )]
    pub protection_reserve_account: Box<Account<'info, TokenAccount>>,
    
    pub collateral_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn subscribe_protection(
    ctx: Context<SubscribeProtection>,
    tier: u8,
    duration_days: u16,
) -> Result<()> {
    require!(tier <= 2, VeilLendError::InvalidProtectionTier);
    require!(
        duration_days >= MIN_PROTECTION_DURATION_DAYS && duration_days <= MAX_PROTECTION_DURATION_DAYS,
        VeilLendError::InvalidDuration
    );
    
    let user_receipt = &ctx.accounts.user_receipt;
    
    require!(
        user_receipt.deposited_collateral > 0,
        VeilLendError::InsufficientCollateral
    );
    
    let collateral_value = user_receipt.deposited_collateral;
    let premium_rate = match tier {
        1 => BASIC_TIER_PREMIUM_RATE,
        2 => PREMIUM_TIER_PREMIUM_RATE,
        _ => return Ok(()),
    };
    
    let premium = collateral_value
        .checked_mul(premium_rate)
        .ok_or(VeilLendError::MathOverflow)?
        .checked_mul(duration_days as u64)
        .ok_or(VeilLendError::MathOverflow)?
        .checked_div(10000 * 30)
        .ok_or(VeilLendError::MathOverflow)?;
    
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_payment_account.to_account_info(),
            to: ctx.accounts.protection_reserve_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, premium)?;
    
    let protection_pool = &mut ctx.accounts.protection_pool;
    protection_pool.reserve_balance = protection_pool.reserve_balance
        .checked_add(premium)
        .ok_or(VeilLendError::MathOverflow)?;
    protection_pool.total_premium_collected = protection_pool.total_premium_collected
        .checked_add(premium)
        .ok_or(VeilLendError::MathOverflow)?;
    
    let coverage_amount = match tier {
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
    
    protection_pool.total_coverage = protection_pool.total_coverage
        .checked_add(coverage_amount)
        .ok_or(VeilLendError::MathOverflow)?;
    
    let user_receipt = &mut ctx.accounts.user_receipt;
    let clock = Clock::get()?;
    
    if user_receipt.protection_tier == 0 {
        protection_pool.total_subscribers = protection_pool.total_subscribers
            .checked_add(1)
            .ok_or(VeilLendError::MathOverflow)?;
    }
    
    user_receipt.protection_tier = tier;
    user_receipt.protection_expiry = clock.unix_timestamp
        .checked_add((duration_days as i64).checked_mul(SECONDS_PER_DAY).ok_or(VeilLendError::MathOverflow)?)
        .ok_or(VeilLendError::MathOverflow)?;
    user_receipt.last_update_timestamp = clock.unix_timestamp;
    
    emit!(ProtectionSubscribedEvent {
        vault: ctx.accounts.vault.key(),
        user: ctx.accounts.user.key(),
        tier,
        duration_days,
        premium,
        coverage_amount,
        expiry: user_receipt.protection_expiry,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

#[event]
pub struct ProtectionSubscribedEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub tier: u8,
    pub duration_days: u16,
    pub premium: u64,
    pub coverage_amount: u64,
    pub expiry: i64,
    pub timestamp: i64,
}
