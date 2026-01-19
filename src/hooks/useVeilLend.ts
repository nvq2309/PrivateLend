import { useCallback, useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { Program, AnchorProvider, BN, Idl } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';

const PROGRAM_ID = new PublicKey('VeiLXJNVnEgYFqEGMHMzY1HnQWpLLFLEjKWTWxGJGxK');

const VAULT_SEED = Buffer.from('vault');
const USER_RECEIPT_SEED = Buffer.from('user_receipt');
const PROTECTION_POOL_SEED = Buffer.from('protection_pool');
const PROTECTION_RESERVE_SEED = Buffer.from('protection_reserve');
const VAULT_COLLATERAL_SEED = Buffer.from('vault_collateral');

export interface Position {
  deposit: number;
  borrow: number;
  shares: number;
  healthFactor: number;
  protectionTier: number;
  protectionExpiry: number;
}

export interface VaultStats {
  totalCollateral: number;
  totalBorrowed: number;
  totalShares: number;
  ltv: number;
  liquidationThreshold: number;
}

export interface ProtectionPoolStats {
  reserveBalance: number;
  totalCoverage: number;
  totalSubscribers: number;
  totalExecutions: number;
  totalPremiumCollected: number;
  totalProtectionPaid: number;
}

const IDL: Idl = {
  version: '0.1.0',
  name: 'veillend',
  instructions: [
    {
      name: 'initialize',
      accounts: [
        { name: 'authority', isMut: true, isSigner: true },
        { name: 'vault', isMut: true, isSigner: false },
        { name: 'protectionPool', isMut: true, isSigner: false },
        { name: 'vaultCollateralAccount', isMut: true, isSigner: false },
        { name: 'protectionReserveAccount', isMut: true, isSigner: false },
        { name: 'collateralMint', isMut: false, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
        { name: 'rent', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'ltvBps', type: 'u64' },
        { name: 'liquidationThresholdBps', type: 'u64' },
      ],
    },
    {
      name: 'deposit',
      accounts: [
        { name: 'user', isMut: true, isSigner: true },
        { name: 'vault', isMut: true, isSigner: false },
        { name: 'userReceipt', isMut: true, isSigner: false },
        { name: 'userTokenAccount', isMut: true, isSigner: false },
        { name: 'vaultCollateralAccount', isMut: true, isSigner: false },
        { name: 'collateralMint', isMut: false, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
    {
      name: 'withdraw',
      accounts: [
        { name: 'user', isMut: true, isSigner: true },
        { name: 'vault', isMut: true, isSigner: false },
        { name: 'userReceipt', isMut: true, isSigner: false },
        { name: 'userTokenAccount', isMut: true, isSigner: false },
        { name: 'vaultCollateralAccount', isMut: true, isSigner: false },
        { name: 'collateralMint', isMut: false, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
    {
      name: 'borrow',
      accounts: [
        { name: 'user', isMut: true, isSigner: true },
        { name: 'vault', isMut: true, isSigner: false },
        { name: 'userReceipt', isMut: true, isSigner: false },
        { name: 'userTokenAccount', isMut: true, isSigner: false },
        { name: 'vaultCollateralAccount', isMut: true, isSigner: false },
        { name: 'collateralMint', isMut: false, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
    {
      name: 'repay',
      accounts: [
        { name: 'user', isMut: true, isSigner: true },
        { name: 'vault', isMut: true, isSigner: false },
        { name: 'userReceipt', isMut: true, isSigner: false },
        { name: 'userTokenAccount', isMut: true, isSigner: false },
        { name: 'vaultCollateralAccount', isMut: true, isSigner: false },
        { name: 'collateralMint', isMut: false, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
    {
      name: 'subscribeProtection',
      accounts: [
        { name: 'user', isMut: true, isSigner: true },
        { name: 'vault', isMut: true, isSigner: false },
        { name: 'userReceipt', isMut: true, isSigner: false },
        { name: 'protectionPool', isMut: true, isSigner: false },
        { name: 'userPaymentAccount', isMut: true, isSigner: false },
        { name: 'protectionReserveAccount', isMut: true, isSigner: false },
        { name: 'collateralMint', isMut: false, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'tier', type: 'u8' },
        { name: 'durationDays', type: 'u16' },
      ],
    },
    {
      name: 'executeProtection',
      accounts: [
        { name: 'caller', isMut: false, isSigner: true },
        { name: 'vault', isMut: true, isSigner: false },
        { name: 'protectedUser', isMut: false, isSigner: false },
        { name: 'userReceipt', isMut: true, isSigner: false },
        { name: 'protectionPool', isMut: true, isSigner: false },
        { name: 'protectionReserveAccount', isMut: true, isSigner: false },
        { name: 'vaultCollateralAccount', isMut: true, isSigner: false },
        { name: 'priceOracle', isMut: false, isSigner: false },
        { name: 'collateralMint', isMut: false, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
      ],
      args: [],
    },
  ],
  accounts: [
    {
      name: 'Vault',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'publicKey' },
          { name: 'collateralMint', type: 'publicKey' },
          { name: 'totalCollateral', type: 'u64' },
          { name: 'totalBorrowed', type: 'u64' },
          { name: 'totalShares', type: 'u64' },
          { name: 'ltvBps', type: 'u64' },
          { name: 'liquidationThresholdBps', type: 'u64' },
          { name: 'isPaused', type: 'bool' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'UserReceipt',
      type: {
        kind: 'struct',
        fields: [
          { name: 'owner', type: 'publicKey' },
          { name: 'vault', type: 'publicKey' },
          { name: 'depositedCollateral', type: 'u64' },
          { name: 'borrowedAmount', type: 'u64' },
          { name: 'shares', type: 'u64' },
          { name: 'protectionTier', type: 'u8' },
          { name: 'protectionExpiry', type: 'i64' },
          { name: 'lastUpdateTimestamp', type: 'i64' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'ProtectionPool',
      type: {
        kind: 'struct',
        fields: [
          { name: 'vault', type: 'publicKey' },
          { name: 'reserveBalance', type: 'u64' },
          { name: 'totalCoverage', type: 'u64' },
          { name: 'totalSubscribers', type: 'u64' },
          { name: 'totalExecutions', type: 'u64' },
          { name: 'totalPremiumCollected', type: 'u64' },
          { name: 'totalProtectionPaid', type: 'u64' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
  ],
  errors: [],
};

export function useVeilLend(collateralMint?: PublicKey) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, signTransaction, signAllTransactions } = wallet;
  
  const [program, setProgram] = useState<Program | null>(null);
  const [myPosition, setMyPosition] = useState<Position | null>(null);
  const [vaultStats, setVaultStats] = useState<VaultStats | null>(null);
  const [protectionPoolStats, setProtectionPoolStats] = useState<ProtectionPoolStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey || !signTransaction || !signAllTransactions) {
      setProgram(null);
      return;
    }

    const provider = new AnchorProvider(
      connection,
      { publicKey, signTransaction, signAllTransactions } as any,
      { commitment: 'confirmed' }
    );
    
    const prog = new Program(IDL, PROGRAM_ID, provider);
    setProgram(prog);
  }, [connection, publicKey, signTransaction, signAllTransactions]);

  const getVaultPDA = useCallback((mint: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [VAULT_SEED, mint.toBuffer()],
      PROGRAM_ID
    )[0];
  }, []);

  const getUserReceiptPDA = useCallback((vault: PublicKey, user: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [USER_RECEIPT_SEED, vault.toBuffer(), user.toBuffer()],
      PROGRAM_ID
    )[0];
  }, []);

  const getProtectionPoolPDA = useCallback((vault: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [PROTECTION_POOL_SEED, vault.toBuffer()],
      PROGRAM_ID
    )[0];
  }, []);

  const getProtectionReservePDA = useCallback((vault: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [PROTECTION_RESERVE_SEED, vault.toBuffer()],
      PROGRAM_ID
    )[0];
  }, []);

  const getVaultCollateralPDA = useCallback((vault: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [VAULT_COLLATERAL_SEED, vault.toBuffer()],
      PROGRAM_ID
    )[0];
  }, []);

  const loadMyPosition = useCallback(async () => {
    if (!program || !publicKey || !collateralMint) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const vault = getVaultPDA(collateralMint);
      const userReceipt = getUserReceiptPDA(vault, publicKey);
      
      const receiptAccount = await program.account.userReceipt.fetchNullable(userReceipt);
      
      if (receiptAccount) {
        const deposit = (receiptAccount.depositedCollateral as BN).toNumber();
        const borrow = (receiptAccount.borrowedAmount as BN).toNumber();
        
        let healthFactor = 0;
        if (borrow > 0) {
          healthFactor = (deposit * 7500) / borrow;
        }
        
        setMyPosition({
          deposit,
          borrow,
          shares: (receiptAccount.shares as BN).toNumber(),
          healthFactor,
          protectionTier: receiptAccount.protectionTier as number,
          protectionExpiry: (receiptAccount.protectionExpiry as BN).toNumber(),
        });
      } else {
        setMyPosition(null);
      }
    } catch (err: any) {
      console.error('Failed to load position:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [program, publicKey, collateralMint, getVaultPDA, getUserReceiptPDA]);

  const loadVaultStats = useCallback(async () => {
    if (!program || !collateralMint) return;
    
    try {
      const vault = getVaultPDA(collateralMint);
      const vaultAccount = await program.account.vault.fetchNullable(vault);
      
      if (vaultAccount) {
        setVaultStats({
          totalCollateral: (vaultAccount.totalCollateral as BN).toNumber(),
          totalBorrowed: (vaultAccount.totalBorrowed as BN).toNumber(),
          totalShares: (vaultAccount.totalShares as BN).toNumber(),
          ltv: (vaultAccount.ltvBps as BN).toNumber() / 100,
          liquidationThreshold: (vaultAccount.liquidationThresholdBps as BN).toNumber() / 100,
        });
      }
    } catch (err: any) {
      console.error('Failed to load vault stats:', err);
    }
  }, [program, collateralMint, getVaultPDA]);

  const loadProtectionPoolStats = useCallback(async () => {
    if (!program || !collateralMint) return;
    
    try {
      const vault = getVaultPDA(collateralMint);
      const protectionPool = getProtectionPoolPDA(vault);
      const poolAccount = await program.account.protectionPool.fetchNullable(protectionPool);
      
      if (poolAccount) {
        setProtectionPoolStats({
          reserveBalance: (poolAccount.reserveBalance as BN).toNumber(),
          totalCoverage: (poolAccount.totalCoverage as BN).toNumber(),
          totalSubscribers: (poolAccount.totalSubscribers as BN).toNumber(),
          totalExecutions: (poolAccount.totalExecutions as BN).toNumber(),
          totalPremiumCollected: (poolAccount.totalPremiumCollected as BN).toNumber(),
          totalProtectionPaid: (poolAccount.totalProtectionPaid as BN).toNumber(),
        });
      }
    } catch (err: any) {
      console.error('Failed to load protection pool stats:', err);
    }
  }, [program, collateralMint, getVaultPDA, getProtectionPoolPDA]);

  const deposit = useCallback(async (amount: number) => {
    if (!program || !publicKey || !collateralMint) throw new Error('Not connected');
    
    setIsLoading(true);
    setError(null);
    
    try {
      const vault = getVaultPDA(collateralMint);
      const userReceipt = getUserReceiptPDA(vault, publicKey);
      const vaultCollateral = getVaultCollateralPDA(vault);
      const userTokenAccount = await getAssociatedTokenAddress(collateralMint, publicKey);
      
      const tx = await program.methods
        .deposit(new BN(amount))
        .accounts({
          user: publicKey,
          vault,
          userReceipt,
          userTokenAccount,
          vaultCollateralAccount: vaultCollateral,
          collateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      await loadMyPosition();
      return tx;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [program, publicKey, collateralMint, getVaultPDA, getUserReceiptPDA, getVaultCollateralPDA, loadMyPosition]);

  const withdraw = useCallback(async (amount: number) => {
    if (!program || !publicKey || !collateralMint) throw new Error('Not connected');
    
    setIsLoading(true);
    setError(null);
    
    try {
      const vault = getVaultPDA(collateralMint);
      const userReceipt = getUserReceiptPDA(vault, publicKey);
      const vaultCollateral = getVaultCollateralPDA(vault);
      const userTokenAccount = await getAssociatedTokenAddress(collateralMint, publicKey);
      
      const tx = await program.methods
        .withdraw(new BN(amount))
        .accounts({
          user: publicKey,
          vault,
          userReceipt,
          userTokenAccount,
          vaultCollateralAccount: vaultCollateral,
          collateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      
      await loadMyPosition();
      return tx;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [program, publicKey, collateralMint, getVaultPDA, getUserReceiptPDA, getVaultCollateralPDA, loadMyPosition]);

  const borrow = useCallback(async (amount: number) => {
    if (!program || !publicKey || !collateralMint) throw new Error('Not connected');
    
    setIsLoading(true);
    setError(null);
    
    try {
      const vault = getVaultPDA(collateralMint);
      const userReceipt = getUserReceiptPDA(vault, publicKey);
      const vaultCollateral = getVaultCollateralPDA(vault);
      const userTokenAccount = await getAssociatedTokenAddress(collateralMint, publicKey);
      
      const tx = await program.methods
        .borrow(new BN(amount))
        .accounts({
          user: publicKey,
          vault,
          userReceipt,
          userTokenAccount,
          vaultCollateralAccount: vaultCollateral,
          collateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      
      await loadMyPosition();
      return tx;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [program, publicKey, collateralMint, getVaultPDA, getUserReceiptPDA, getVaultCollateralPDA, loadMyPosition]);

  const repay = useCallback(async (amount: number) => {
    if (!program || !publicKey || !collateralMint) throw new Error('Not connected');
    
    setIsLoading(true);
    setError(null);
    
    try {
      const vault = getVaultPDA(collateralMint);
      const userReceipt = getUserReceiptPDA(vault, publicKey);
      const vaultCollateral = getVaultCollateralPDA(vault);
      const userTokenAccount = await getAssociatedTokenAddress(collateralMint, publicKey);
      
      const tx = await program.methods
        .repay(new BN(amount))
        .accounts({
          user: publicKey,
          vault,
          userReceipt,
          userTokenAccount,
          vaultCollateralAccount: vaultCollateral,
          collateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      
      await loadMyPosition();
      return tx;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [program, publicKey, collateralMint, getVaultPDA, getUserReceiptPDA, getVaultCollateralPDA, loadMyPosition]);

  const subscribeProtection = useCallback(async (tier: number, durationDays: number) => {
    if (!program || !publicKey || !collateralMint) throw new Error('Not connected');
    
    setIsLoading(true);
    setError(null);
    
    try {
      const vault = getVaultPDA(collateralMint);
      const userReceipt = getUserReceiptPDA(vault, publicKey);
      const protectionPool = getProtectionPoolPDA(vault);
      const protectionReserve = getProtectionReservePDA(vault);
      const userPaymentAccount = await getAssociatedTokenAddress(collateralMint, publicKey);
      
      const tx = await program.methods
        .subscribeProtection(tier, durationDays)
        .accounts({
          user: publicKey,
          vault,
          userReceipt,
          protectionPool,
          userPaymentAccount,
          protectionReserveAccount: protectionReserve,
          collateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      await loadMyPosition();
      await loadProtectionPoolStats();
      return tx;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [program, publicKey, collateralMint, getVaultPDA, getUserReceiptPDA, getProtectionPoolPDA, getProtectionReservePDA, loadMyPosition, loadProtectionPoolStats]);

  const executeProtection = useCallback(async (protectedUser: PublicKey, priceOracle: PublicKey) => {
    if (!program || !publicKey || !collateralMint) throw new Error('Not connected');
    
    setIsLoading(true);
    setError(null);
    
    try {
      const vault = getVaultPDA(collateralMint);
      const userReceipt = getUserReceiptPDA(vault, protectedUser);
      const protectionPool = getProtectionPoolPDA(vault);
      const protectionReserve = getProtectionReservePDA(vault);
      const vaultCollateral = getVaultCollateralPDA(vault);
      
      const tx = await program.methods
        .executeProtection()
        .accounts({
          caller: publicKey,
          vault,
          protectedUser,
          userReceipt,
          protectionPool,
          protectionReserveAccount: protectionReserve,
          vaultCollateralAccount: vaultCollateral,
          priceOracle,
          collateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      
      await loadProtectionPoolStats();
      return tx;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [program, publicKey, collateralMint, getVaultPDA, getUserReceiptPDA, getProtectionPoolPDA, getProtectionReservePDA, getVaultCollateralPDA, loadProtectionPoolStats]);

  useEffect(() => {
    if (program && publicKey && collateralMint) {
      loadMyPosition();
      loadVaultStats();
      loadProtectionPoolStats();
    }
  }, [program, publicKey, collateralMint, loadMyPosition, loadVaultStats, loadProtectionPoolStats]);

  return {
    program,
    myPosition,
    vaultStats,
    protectionPoolStats,
    isLoading,
    error,
    deposit,
    withdraw,
    borrow,
    repay,
    subscribeProtection,
    executeProtection,
    loadMyPosition,
    loadVaultStats,
    loadProtectionPoolStats,
  };
}

export default useVeilLend;
