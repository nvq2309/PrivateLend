use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::constants::MERKLE_TREE_DEPTH;
use crate::errors::VeilLendError;
use crate::state::{MerkleTree, Nullifier};

fn hash_pair(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let hash = hashv(&[left, right]);
    hash.to_bytes()
}

fn compute_zero_hashes(depth: usize) -> Vec<[u8; 32]> {
    let mut hashes = Vec::with_capacity(depth + 1);
    hashes.push([0u8; 32]);
    for i in 0..depth {
        let next = hash_pair(&hashes[i], &hashes[i]);
        hashes.push(next);
    }
    hashes
}

pub fn initialize_merkle_tree(tree: &mut MerkleTree) {
    let zeros = compute_zero_hashes(MERKLE_TREE_DEPTH);
    tree.depth = MERKLE_TREE_DEPTH as u8;
    tree.root = zeros[MERKLE_TREE_DEPTH];
    tree.next_index = 0;
    tree.filled_subtrees = [[0u8; 32]; MERKLE_TREE_DEPTH];
}

pub fn append_leaf(tree: &mut MerkleTree, leaf: [u8; 32]) -> Result<u32> {
    if tree.depth as usize != MERKLE_TREE_DEPTH {
        return err!(VeilLendError::MerkleDepthMismatch);
    }
    let depth = tree.depth as usize;
    let max_leaves = 1usize << depth;
    let current_index = tree.next_index as usize;
    if current_index >= max_leaves {
        return err!(VeilLendError::MerkleTreeFull);
    }

    let zeros = compute_zero_hashes(depth);
    let mut index = current_index;
    let mut current = leaf;

    for level in 0..depth {
        if index % 2 == 0 {
            tree.filled_subtrees[level] = current;
            current = hash_pair(&current, &zeros[level]);
        } else {
            let left = tree.filled_subtrees[level];
            current = hash_pair(&left, &current);
        }
        index /= 2;
    }

    tree.root = current;
    tree.next_index = tree
        .next_index
        .checked_add(1)
        .ok_or(VeilLendError::MathOverflow)?;

    Ok(current_index as u32)
}

pub fn verify_merkle_proof(
    leaf: [u8; 32],
    root: [u8; 32],
    proof: &Vec<[u8; 32]>,
    path: &Vec<u8>,
) -> Result<()> {
    if proof.len() != path.len() || proof.len() != MERKLE_TREE_DEPTH {
        return err!(VeilLendError::MerkleDepthMismatch);
    }

    let mut current = leaf;
    for (sibling, direction) in proof.iter().zip(path.iter()) {
        current = match direction {
            0 => hash_pair(&current, sibling),
            1 => hash_pair(sibling, &current),
            _ => return err!(VeilLendError::InvalidMerklePath),
        };
    }

    if current != root {
        return err!(VeilLendError::MerkleProofInvalid);
    }

    Ok(())
}

pub fn spend_note(
    tree: &MerkleTree,
    nullifier: &mut Nullifier,
    vault: Pubkey,
    commitment: [u8; 32],
    proof: &Vec<[u8; 32]>,
    path: &Vec<u8>,
) -> Result<()> {
    verify_merkle_proof(commitment, tree.root, proof, path)?;

    if nullifier.spent {
        return err!(VeilLendError::NullifierAlreadySpent);
    }

    if nullifier.vault != Pubkey::default() && nullifier.vault != vault {
        return err!(VeilLendError::InvalidVaultState);
    }

    nullifier.vault = vault;
    nullifier.spent = true;

    Ok(())
}
