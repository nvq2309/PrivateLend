export type LendingMode = 'FAST' | 'SECURE';

export type ActionResult = {
  signature: string;
  proof?: {
    proof: unknown;
    publicSignals: string[];
  };
};

export type LendingAdapter = {
  mode: LendingMode;
  supply: (amount: number) => Promise<ActionResult>;
  withdraw: (amount: number) => Promise<ActionResult>;
  borrow: (amount: number) => Promise<ActionResult>;
  repay: (amount: number) => Promise<ActionResult>;
};

type FastAdapterDeps = {
  deposit: (amount: number) => Promise<ActionResult>;
  withdraw: (amount: number) => Promise<ActionResult>;
  borrow: (amount: number) => Promise<ActionResult>;
  repay: (amount: number) => Promise<ActionResult>;
};

export const createFastAdapter = (deps: FastAdapterDeps): LendingAdapter => ({
  mode: 'FAST',
  supply: deps.deposit,
  withdraw: deps.withdraw,
  borrow: deps.borrow,
  repay: deps.repay,
});
