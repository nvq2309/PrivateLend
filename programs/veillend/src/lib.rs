use anchor_lang::prelude::*;

pub mod arcium;
pub mod constants;
pub mod errors;
pub mod instructions;
pub mod merkle;
pub mod state;
pub mod zk_keys;
pub mod zk_verifier;

use instructions::*;

declare_id!("EESy32LNihZW9iNTaGTuzCt1meWr5pjrDzt63fJEAE8t");

#[program]
pub mod veillend {
    use super::*;

    // From PR#2 - initialization
    pub fn initialize(
        ctx: Context<Initialize>,
        ltv_bps: u64,
        liquidation_threshold_bps: u64,
    ) -> Result<()> {
        instructions::initialize::initialize(ctx, ltv_bps, liquidation_threshold_bps)
    }

    pub fn initialize_mints(ctx: Context<InitializeMints>) -> Result<()> {
        instructions::initialize_mints::initialize_mints(ctx)
    }

    pub fn initialize_protection(ctx: Context<InitializeProtection>) -> Result<()> {
        instructions::initialize_protection::initialize_protection(ctx)
    }

    pub fn initialize_merkle_tree(ctx: Context<InitializeMerkleTree>) -> Result<()> {
        instructions::initialize_merkle_tree::initialize_merkle_tree(ctx)
    }

    // From main - with Arcium encryption
    pub fn deposit(
        ctx: Context<Deposit>,
        amount: u64,
        encrypted_balance: [u8; 32],
        client_pubkey: [u8; 32],
    ) -> Result<()> {
        instructions::deposit::deposit(ctx, amount, encrypted_balance, client_pubkey)
    }

    pub fn deposit_secure(
        ctx: Context<DepositSecure>,
        amount: u64,
        encrypted_balance: [u8; 32],
        client_pubkey: [u8; 32],
        note_hash: [u8; 32],
        commitment: [u8; 32],
    ) -> Result<()> {
        instructions::deposit_secure::deposit_secure(
            ctx,
            amount,
            encrypted_balance,
            client_pubkey,
            note_hash,
            commitment,
        )
    }

    pub fn deposit_secure_spend(
        ctx: Context<DepositSecureSpend>,
        amount: u64,
        encrypted_balance: [u8; 32],
        current_commitment: [u8; 32],
        new_commitment: [u8; 32],
        nullifier: [u8; 32],
        proof: zk_verifier::Groth16Proof,
        merkle_proof: Vec<[u8; 32]>,
        merkle_path: Vec<u8>,
    ) -> Result<()> {
        instructions::deposit_secure_spend::deposit_secure_spend(
            ctx,
            amount,
            encrypted_balance,
            current_commitment,
            new_commitment,
            nullifier,
            proof,
            merkle_proof,
            merkle_path,
        )
    }

    pub fn shield_position(
        ctx: Context<ShieldPosition>,
        note_hash: [u8; 32],
        commitment: [u8; 32],
    ) -> Result<()> {
        instructions::shield_position::shield_position(ctx, note_hash, commitment)
    }

    pub fn withdraw(
        ctx: Context<Withdraw>,
        shares_to_burn: u64,
        encrypted_balance: [u8; 32],
    ) -> Result<()> {
        instructions::withdraw::withdraw(ctx, shares_to_burn, encrypted_balance)
    }

    pub fn withdraw_secure(
        ctx: Context<WithdrawSecure>,
        shares_to_burn: u64,
        encrypted_balance: [u8; 32],
        current_commitment: [u8; 32],
        new_commitment: [u8; 32],
        nullifier: [u8; 32],
        proof: zk_verifier::Groth16Proof,
        merkle_proof: Vec<[u8; 32]>,
        merkle_path: Vec<u8>,
    ) -> Result<()> {
        instructions::withdraw_secure::withdraw_secure(
            ctx,
            shares_to_burn,
            encrypted_balance,
            current_commitment,
            new_commitment,
            nullifier,
            proof,
            merkle_proof,
            merkle_path,
        )
    }

    pub fn borrow(ctx: Context<Borrow>, amount: u64, encrypted_balance: [u8; 32]) -> Result<()> {
        instructions::borrow::borrow(ctx, amount, encrypted_balance)
    }

    pub fn borrow_secure<'info>(
        ctx: Context<'_, '_, '_, 'info, BorrowSecure<'info>>,
        amount: u64,
        encrypted_balance: [u8; 32],
        current_commitment: [u8; 32],
        new_commitment: [u8; 32],
        nullifier: [u8; 32],
        proof: zk_verifier::Groth16Proof,
        merkle_proof: Vec<[u8; 32]>,
        merkle_path: Vec<u8>,
    ) -> Result<()> {
        instructions::borrow_secure::borrow_secure(
            ctx,
            amount,
            encrypted_balance,
            current_commitment,
            new_commitment,
            nullifier,
            proof,
            merkle_proof,
            merkle_path,
        )
    }

    pub fn repay(ctx: Context<Repay>, amount: u64, encrypted_balance: [u8; 32]) -> Result<()> {
        instructions::repay::repay(ctx, amount, encrypted_balance)
    }

    pub fn repay_secure<'info>(
        ctx: Context<'_, '_, '_, 'info, RepaySecure<'info>>,
        amount: u64,
        encrypted_balance: [u8; 32],
        current_commitment: [u8; 32],
        new_commitment: [u8; 32],
        nullifier: [u8; 32],
        proof: zk_verifier::Groth16Proof,
        merkle_proof: Vec<[u8; 32]>,
        merkle_path: Vec<u8>,
    ) -> Result<()> {
        instructions::repay_secure::repay_secure(
            ctx,
            amount,
            encrypted_balance,
            current_commitment,
            new_commitment,
            nullifier,
            proof,
            merkle_proof,
            merkle_path,
        )
    }

    // From PR#2 - protection system
    pub fn subscribe_protection(
        ctx: Context<SubscribeProtection>,
        tier: u8,
        duration_days: u16,
    ) -> Result<()> {
        instructions::subscribe_protection::subscribe_protection(ctx, tier, duration_days)
    }

    pub fn execute_protection(ctx: Context<ExecuteProtection>) -> Result<()> {
        instructions::execute_protection::execute_protection(ctx)
    }
}
