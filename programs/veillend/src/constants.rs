use anchor_lang::prelude::*;

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

#[constant]
pub const USER_RECEIPT_SEED: &[u8] = b"user_receipt";

#[constant]
pub const PROTECTION_POOL_SEED: &[u8] = b"protection_pool";

#[constant]
pub const PROTECTION_RESERVE_SEED: &[u8] = b"protection_reserve";

#[constant]
pub const VAULT_COLLATERAL_SEED: &[u8] = b"vault_collateral";

pub const BASIC_TIER_COVERAGE_BPS: u64 = 500;
pub const PREMIUM_TIER_COVERAGE_BPS: u64 = 1000;

pub const BASIC_TIER_THRESHOLD_BPS: u64 = 11500;
pub const PREMIUM_TIER_THRESHOLD_BPS: u64 = 10500;

pub const BASIC_TIER_PREMIUM_RATE: u64 = 50;
pub const PREMIUM_TIER_PREMIUM_RATE: u64 = 100;

pub const TARGET_HEALTH_FACTOR_BPS: u64 = 15000;
pub const DEFAULT_LTV_BPS: u64 = 7500;

pub const MIN_PROTECTION_DURATION_DAYS: u16 = 7;
pub const MAX_PROTECTION_DURATION_DAYS: u16 = 365;
pub const SECONDS_PER_DAY: i64 = 86400;
