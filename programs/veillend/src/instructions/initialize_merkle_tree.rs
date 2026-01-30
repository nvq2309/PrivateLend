use crate::constants::*;
use crate::merkle::initialize_merkle_tree as init_tree;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitializeMerkleTree<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub vault: Box<Account<'info, Vault>>,

    #[account(
        init,
        payer = authority,
        space = 8 + MerkleTree::INIT_SPACE,
        seeds = [MERKLE_TREE_SEED, vault.key().as_ref()],
        bump,
    )]
    pub merkle_tree: Box<Account<'info, MerkleTree>>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_merkle_tree(ctx: Context<InitializeMerkleTree>) -> Result<()> {
    let tree = &mut ctx.accounts.merkle_tree;
    msg!(
        "[debug][sc] initialize_merkle_tree vault={} merkle_tree={}",
        ctx.accounts.vault.key(),
        tree.key()
    );
    tree.vault = ctx.accounts.vault.key();
    tree.bump = ctx.bumps.merkle_tree;
    init_tree(tree)?;
    msg!(
        "[debug][sc] merkle initialized root={:?} next_index={}",
        tree.root,
        tree.next_index
    );

    emit!(MerkleTreeInitializedEvent {
        vault: tree.vault,
        root: tree.root,
        depth: tree.depth,
    });

    Ok(())
}

#[event]
pub struct MerkleTreeInitializedEvent {
    pub vault: Pubkey,
    pub root: [u8; 32],
    pub depth: u8,
}
