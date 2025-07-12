export const STEER_LP_ABI = [
  {
    inputs: [],
    name: 'pool',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const STRATEGY_ABI = [
  {
    inputs: [],
    name: 'STEER_LP',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const MORPHO_LP_ABI = [
  {
    inputs: [],
    name: 'vault',
    outputs: [{ internalType: 'contract IStrategy', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
