import type { YearnVault } from '../../types'
import { MerklApiService } from '../externalApis/merklApi'
import { YearnApiService } from '../externalApis/yearnApi'
import { ContractReaderService } from '../contractReader'
import type { APRCalculator, RewardCalculatorResult } from './types'
import { calculateYearnVaultRewardsAPR } from './utils'

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
    const WRAPPED_KAT_ADDRESS = '0x6E9C1F88a960fE63387eb4b71BC525a9313d8461'

    // Calculate APRs for each vault
    const resultEntries = vaults.map((vault) => {
      const vaultResults = calculateYearnVaultRewardsAPR(
        vault.address,
        yearnOpportunities,
        'yearn',
        WRAPPED_KAT_ADDRESS
      )
      return [vault.address, vaultResults]
    })
    return Object.fromEntries(resultEntries)
  }
}
