use anchor_lang::prelude::*;
use solana_poseidon::{hashv, Endianness, Parameters};

use crate::errors::VeilLendError;
use crate::zk_keys::{BORROW_VK, REPAY_VK, SUPPLY_VK, WITHDRAW_VK};

extern "C" {
    pub fn sol_alt_bn128_group_op(
        group_op: u64,
        input: *const u8,
        input_len: u64,
        result: *mut u8,
    ) -> u64;
}

pub fn alt_bn128_addition(input: &[u8]) -> Result<[u8; 64]> {
    let mut result = [0u8; 64];
    let ret = unsafe {
        sol_alt_bn128_group_op(
            0, // ADD
            input.as_ptr(),
            input.len() as u64,
            result.as_mut_ptr(),
        )
    };
    if ret != 0 {
        return err!(VeilLendError::ZkProofInvalid);
    }
    Ok(result)
}

pub fn alt_bn128_multiplication(input: &[u8]) -> Result<[u8; 64]> {
    let mut result = [0u8; 64];
    let ret = unsafe {
        sol_alt_bn128_group_op(
            2, // MUL
            input.as_ptr(),
            input.len() as u64,
            result.as_mut_ptr(),
        )
    };
    if ret != 0 {
        return err!(VeilLendError::ZkProofInvalid);
    }
    Ok(result)
}

pub fn alt_bn128_pairing(input: &[u8]) -> Result<[u8; 32]> {
    let mut result = [0u8; 32];
    let ret = unsafe {
        sol_alt_bn128_group_op(
            3, // PAIRING
            input.as_ptr(),
            input.len() as u64,
            result.as_mut_ptr(),
        )
    };
    if ret != 0 {
        return err!(VeilLendError::ZkProofInvalid);
    }
    Ok(result)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct Groth16Proof {
    pub a_x: [u8; 32],
    pub a_y: [u8; 32],
    pub b_x_0: [u8; 32],
    pub b_x_1: [u8; 32],
    pub b_y_0: [u8; 32],
    pub b_y_1: [u8; 32],
    pub c_x: [u8; 32],
    pub c_y: [u8; 32],
}

#[derive(Clone, Copy)]
pub enum ZkAction {
    Supply,
    Borrow,
    Repay,
    Withdraw,
}

const BN254_FIELD_MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

fn g1_negate(y: [u8; 32]) -> [u8; 32] {
    let mut res = [0u8; 32];
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let val = (BN254_FIELD_MODULUS[i] as i16) - (y[i] as i16) - borrow;
        if val < 0 {
            res[i] = (val + 256) as u8;
            borrow = 1;
        } else {
            res[i] = val as u8;
            borrow = 0;
        }
    }
    res
}

fn g1_add(p1: [u8; 64], p2: [u8; 64]) -> Result<[u8; 64]> {
    let mut input = [0u8; 128];
    input[0..64].copy_from_slice(&p1);
    input[64..128].copy_from_slice(&p2);
    let result = alt_bn128_addition(&input).map_err(|_| VeilLendError::ZkProofInvalid)?;
    let mut out = [0u8; 64];
    out.copy_from_slice(&result);
    Ok(out)
}

fn g1_mul(p: [u8; 64], s: [u8; 32]) -> Result<[u8; 64]> {
    let mut input = [0u8; 96];
    input[0..64].copy_from_slice(&p);
    input[64..96].copy_from_slice(&s);
    let result = alt_bn128_multiplication(&input).map_err(|_| VeilLendError::ZkProofInvalid)?;
    let mut out = [0u8; 64];
    out.copy_from_slice(&result);
    Ok(out)
}

pub fn poseidon_nullifier_hash(nullifier: &[u8; 32]) -> Result<[u8; 32]> {
    let zero = [0u8; 32];
    let hash = hashv(
        Parameters::Bn254X5,
        Endianness::BigEndian,
        &[nullifier, &zero],
    )
    .map_err(|_| VeilLendError::PoseidonHashFailed)?;
    msg!("Nullifier Hash: {:?}", hash.to_bytes());
    Ok(hash.to_bytes())
}

pub fn verify_groth16_proof(
    action: ZkAction,
    proof: &Groth16Proof,
    public_inputs: &[[u8; 32]; 4],
) -> Result<()> {
    let vk = match action {
        ZkAction::Supply => &SUPPLY_VK,
        ZkAction::Borrow => &BORROW_VK,
        ZkAction::Repay => &REPAY_VK,
        ZkAction::Withdraw => &WITHDRAW_VK,
    };

    let mut l = vk.ic[0];
    for i in 0..4 {
        let term = g1_mul(vk.ic[i + 1], public_inputs[i])?;
        l = g1_add(l, term)?;
    }

    msg!("Public Inputs:");
    for (i, input) in public_inputs.iter().enumerate() {
        msg!("Input {}: {:?}", i, input);
    }
    msg!("L: {:?}", l);

    let mut pairing_input = [0u8; 192 * 4];

    pairing_input[0..32].copy_from_slice(&proof.a_x);
    pairing_input[32..64].copy_from_slice(&g1_negate(proof.a_y));
    pairing_input[64..96].copy_from_slice(&proof.b_x_1);
    pairing_input[96..128].copy_from_slice(&proof.b_x_0);
    pairing_input[128..160].copy_from_slice(&proof.b_y_1);
    pairing_input[160..192].copy_from_slice(&proof.b_y_0);

    pairing_input[192..256].copy_from_slice(&vk.alpha_1);
    pairing_input[256..384].copy_from_slice(&vk.beta_2);

    pairing_input[384..448].copy_from_slice(&l);
    pairing_input[448..576].copy_from_slice(&vk.gamma_2);

    pairing_input[576..608].copy_from_slice(&proof.c_x);
    pairing_input[608..640].copy_from_slice(&proof.c_y);
    pairing_input[640..768].copy_from_slice(&vk.delta_2);

    let result = alt_bn128_pairing(&pairing_input).map_err(|_| VeilLendError::ZkProofInvalid)?;

    if result.len() != 32 || result[31] != 1 {
        return err!(VeilLendError::ZkProofInvalid);
    }

    Ok(())
}
