import { createConfig } from '@wagmi/core'
import dotenv from 'dotenv'
import { defineChain, http } from 'viem'

dotenv.config()

const parseBoolean = (value?: string): boolean => value === 'true'

const parsePositiveInteger = (value?: string): number | undefined => {
  if (!value) {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export const config = {
  port: process.env.PORT || 3000,
  katanaChainId: 747474,
  // biome-ignore lint/style/noNonNullAssertion: temp
  rpcUrl: process.env.RPC_URL_KATANA!,
  yearnApiUrl: process.env.YDAEMON_BASE_URI || 'https://ydaemon.yearn.fi',
  merklApiUrl: process.env.MERKL_BASE_URI || 'https://api.merkl.xyz',
  aprDebugEnabled: parseBoolean(process.env.APR_DEBUG_ENABLED),
  aprDebugVaultAddress: process.env.APR_DEBUG_VAULT_ADDRESS?.toLowerCase(),
  aprDebugSampleLimit: parsePositiveInteger(process.env.APR_DEBUG_SAMPLE_LIMIT),
  katanaTokenFDV: 1_000_000_000, // 1B FDV default
  multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11' as const,
}

export const katana = defineChain({
  id: 747474,
  name: 'Katana',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: [config.rpcUrl],
    },
  },
  contracts: {
    multicall3: {
      address: config.multicallAddress as `0x${string}`,
      blockCreated: 0,
    },
  },
})

export const wagmiConfig = createConfig({
  chains: [katana],
  transports: {
    [katana.id]: http(config.rpcUrl),
  },
})
