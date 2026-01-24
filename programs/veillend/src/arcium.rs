use solana_sha256_hasher::hashv;

pub fn is_zero_pubkey(pubkey: &[u8; 32]) -> bool {
    pubkey.iter().all(|value| *value == 0)
}

pub fn derive_commitment(encrypted_balance: &[u8; 32], client_pubkey: &[u8; 32]) -> [u8; 32] {
    let hash = hashv(&[encrypted_balance, client_pubkey]);
    hash.to_bytes()
}
