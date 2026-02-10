import type { YearnVault } from '../../types'
import { MerklApiService } from '../externalApis/merklApi'
import { YearnApiService } from '../externalApis/yearnApi'
import { ContractReaderService } from '../contractReader'
import type { APRCalculator, RewardCalculatorResult } from './types'
import { calculateYearnVaultRewardsAPR } from './utils'

const WRAPPED_KAT_ADDRESSES = [
  '0x6E9C1F88a960fE63387eb4b71BC525a9313d8461', // v2WrappedKat,
  '0x3ba1fbC4c3aEA775d335b31fb53778f46FD3a330', // v1WrappedKat
  '0x0161A31702d6CF715aaa912d64c6A190FD0093aa', // KAT
]

/**
 * Calculates the APRs for rewards that are forwarded directly to Yearn vaults,
 * specifically addressing cases where Steer rewards are stuck at the strategies.
 *
 * @param vaults - An array of YearnVault objects representing the vaults for which to calculate forwarded APRs.
 * @returns A promise that resolves to a record mapping each vault address (string) to an array of RewardCalculatorResult objects.
 *
 * @remarks
 * This function fetches ERC20 log processor opportunities from the Merkl API,
 * then calculates the APR for each provided vault using the `calculateYearnVaultRewardsAPR` utility.
 * The results are returned as a mapping from vault address to calculated APR results.
 */
export class YearnAprCalculator implements APRCalculator {
  private merklApi: MerklApiService
  private yearnApi: YearnApiService
  private contractReader: ContractReaderService

  constructor() {
    this.merklApi = new MerklApiService()
    this.yearnApi = new YearnApiService()
    this.contractReader = new ContractReaderService()
  }

  async calculateVaultAPRs(
    vaults: YearnVault[]
  ): Promise<Record<string, RewardCalculatorResult[]>> {
    const yearnOpportunities =
      await this.merklApi.getErc20LogProcessorOpportunities()

    // Calculate APRs for each vault
    const resultEntries = vaults.map((vault) => {
      const vaultResults = calculateYearnVaultRewardsAPR(
        vault.name,
        vault.address,
        yearnOpportunities,
        'yearn',
        WRAPPED_KAT_ADDRESSES
      )
      return [vault.address, vaultResults]
    })
    return Object.fromEntries(resultEntries)
  }

  async calculateFixedRateVaultAPRs(
    vaults: YearnVault[]
  ): Promise<Record<string, RewardCalculatorResult[]>> {
    const FixedRateOpportunities =
      await this.merklApi.getErc20FixAprOpportunities()

    // Calculate APRs for each vault
    const resultEntries = vaults.map((vault) => {
      const vaultResults = calculateYearnVaultRewardsAPR(
        vault.name,
        vault.address,
        FixedRateOpportunities,
        'fixed rate',
        WRAPPED_KAT_ADDRESSES
      )
      return [vault.address, vaultResults]
    })
    return Object.fromEntries(resultEntries)
  }
}
