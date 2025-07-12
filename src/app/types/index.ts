export * from './contracts';
export * from './merkl';
export * from './yearn';

export interface VaultAPR {
  vaultAddress: string;
  chainId: number;
  totalAPR: number;
  katAPR: number;
  autoCompoundedAPY: number;
  strategies: StrategyAPR[];
}

export interface StrategyAPR {
  address: string;
  type: 'sushi' | 'morpho';
  katAPR: number;
  underlyingPool?: string;
  weight: number;
}
