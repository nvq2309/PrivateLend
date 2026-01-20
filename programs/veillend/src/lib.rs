use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("VeilLend111111111111111111111111111111111111111");

#[program]
pub mod veillend {
    use super::*;

    pub fn deposit(
        ctx: Context<Deposit>,
        amount: u64,
        encrypted_balance: [u8; 32],
        client_pubkey: [u8; 32],
    ) -> Result<()> {
        instructions::deposit::deposit(ctx, amount, encrypted_balance, client_pubkey)
    }

    pub fn withdraw(
        ctx: Context<Withdraw>,
        shares_to_burn: u64,
        encrypted_balance: [u8; 32],
    ) -> Result<()> {
        instructions::withdraw::withdraw(ctx, shares_to_burn, encrypted_balance)
    }

    pub fn borrow(
        ctx: Context<Borrow>,
        amount: u64,
        encrypted_balance: [u8; 32],
    ) -> Result<()> {
        instructions::borrow::borrow(ctx, amount, encrypted_balance)
    }

    pub fn repay(
        ctx: Context<Repay>,
        amount: u64,
        encrypted_balance: [u8; 32],
    ) -> Result<()> {
        instructions::repay::repay(ctx, amount, encrypted_balance)
    }
}
