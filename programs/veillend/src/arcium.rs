use crate::errors::VeilLendError;
use anchor_lang::prelude::*;
use solana_poseidon::{hashv, Endianness, Parameters};

pub fn is_zero_pubkey(pubkey: &[u8; 32]) -> bool {
    pubkey.iter().all(|value| *value == 0)
}

pub fn derive_commitment(
    encrypted_balance: &[u8; 32],
    client_pubkey: &[u8; 32],
) -> Result<[u8; 32]> {
    let hash = hashv(
        Parameters::Bn254X5,
        Endianness::BigEndian,
        &[encrypted_balance, client_pubkey],
    )
    .map_err(|_| VeilLendError::PoseidonHashFailed)?;
    Ok(hash.to_bytes())
}
