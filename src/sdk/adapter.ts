export type LendingMode = 'FAST' | 'SECURE';

export type LendingAdapter = {
  mode: LendingMode;
  supply: (amount: number) => Promise<string>;
  withdraw: (amount: number) => Promise<string>;
  borrow: (amount: number) => Promise<string>;
  repay: (amount: number) => Promise<string>;
};

type FastAdapterDeps = {
  deposit: (amount: number) => Promise<string>;
  withdraw: (amount: number) => Promise<string>;
  borrow: (amount: number) => Promise<string>;
  repay: (amount: number) => Promise<string>;
};

export const createFastAdapter = (deps: FastAdapterDeps): LendingAdapter => ({
  mode: 'FAST',
  supply: deps.deposit,
  withdraw: deps.withdraw,
  borrow: deps.borrow,
  repay: deps.repay,
});
