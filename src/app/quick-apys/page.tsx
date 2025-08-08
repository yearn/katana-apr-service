'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'

import type { YearnVault } from '../types/yearn'

type VaultDisplay = {
  key: string
  name: string
  netAPR: string
  katanaRewardsAPR: string
  katanaAppRewardsAPR: string
  fixedRateKatanaRewards: string
  katanaBonusAPY: string
  extrinsicYield: string
  katanaNativeYield: string
  totalAPR: string
}

export default function QuickAPYs(): React.ReactElement {
  const [vaults, setVaults] = useState<VaultDisplay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    console.log('Fetching vaults...')
    fetch('/api/vaults')
      .then((res) => {
        console.log('Fetch response:', res)
        if (!res.ok) throw new Error('Failed to fetch vaults')
        return res.json()
      })
      .then((data) => {
        console.log('Fetched data:', data)
        let vaultsArr: YearnVault[] = []
        // If the API returns { vaults: ... }
        if (data && data.vaults !== undefined) {
          console.log(
            'Parsing vaults, typeof data.vaults:',
            typeof data.vaults,
            'Array.isArray:',
            Array.isArray(data.vaults)
          )
          if (
            data.vaults &&
            typeof data.vaults === 'object' &&
            !Array.isArray(data.vaults)
          ) {
            vaultsArr = Object.values(data.vaults)
            console.log('Converted vaults object to array:', vaultsArr)
          } else if (Array.isArray(data.vaults)) {
            vaultsArr = data.vaults
            console.log('Using vaults array directly:', vaultsArr)
          } else {
            console.log(
              'No vaults found or vaults is not an object/array:',
              data.vaults
            )
          }
        } else if (data && typeof data === 'object' && !Array.isArray(data)) {
          // If the API returns the vaults object directly
          vaultsArr = Object.values(data)
          console.log(
            'API returned vaults object directly, converted to array:',
            vaultsArr
          )
        } else if (Array.isArray(data)) {
          // If the API returns the vaults array directly
          vaultsArr = data
          console.log('API returned vaults array directly:', vaultsArr)
        } else {
          console.log('No vaults found or data is not an object/array:', data)
        }
        const displayVaults: VaultDisplay[] = vaultsArr.map((vault) => {
          const netAPR =
            vault.apr && typeof vault.apr.netAPR === 'number'
              ? vault.apr.netAPR
              : 0
          const katanaRewardsAPR = vault.apr?.extra?.katanaRewardsAPR || 0
          const katanaAppRewardsAPR = vault.apr?.extra?.katanaAppRewardsAPR || 0
          const fixedRateKatanaRewards =
            vault.apr?.extra?.FixedRateKatanaRewards || 0
          const katanaBonusAPY = vault.apr?.extra?.katanaBonusAPY || 0
          const extrinsicYield = vault.apr?.extra?.extrinsicYield || 0
          const katanaNativeYield = vault.apr?.extra?.katanaNativeYield || 0

          // Calculate total APR as sum of all components
          const totalAPR =
            netAPR +
            katanaAppRewardsAPR +
            fixedRateKatanaRewards +
            katanaBonusAPY +
            extrinsicYield +
            katanaNativeYield

          return {
            key: vault.address,
            name: vault.name,
            netAPR: (netAPR * 100).toFixed(2),
            katanaRewardsAPR: (katanaRewardsAPR * 100).toFixed(2),
            katanaAppRewardsAPR: (katanaAppRewardsAPR * 100).toFixed(2),
            fixedRateKatanaRewards: (fixedRateKatanaRewards * 100).toFixed(2),
            katanaBonusAPY: (katanaBonusAPY * 100).toFixed(2),
            extrinsicYield: (extrinsicYield * 100).toFixed(2),
            katanaNativeYield: (katanaNativeYield * 100).toFixed(2),
            totalAPR: (totalAPR * 100).toFixed(2),
          }
        })
        console.log('Display vaults:', displayVaults)
        setVaults(displayVaults)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Error fetching vaults:', err)
        setError(err.message)
        setLoading(false)
      })
  }, [])

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-white to-gray-100 dark:from-[#18181b] dark:to-[#23232a] px-4 py-12">
      <section className="w-full max-w-6xl bg-white/80 dark:bg-zinc-900/80 rounded-2xl shadow-xl p-8 flex flex-col items-center gap-8 border border-zinc-200 dark:border-zinc-800">
        <h1 className="text-3xl font-bold text-center text-zinc-900 dark:text-white tracking-tight mb-2">
          Quick APYs
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 text-center mb-4">
          Comprehensive breakdown of all APR components including rewards,
          bonuses, and yields
        </p>
        <Link
          href="/"
          className="text-blue-600 dark:text-blue-400 underline mb-4"
        >
          ← Back to Home
        </Link>
        {loading ? (
          <p className="text-zinc-700 dark:text-zinc-300">Loading...</p>
        ) : error ? (
          <p className="text-red-600 dark:text-red-400">{error}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr>
                    <th className="px-2 py-2 border-b border-zinc-300 dark:border-zinc-700 text-sm">
                      Name
                    </th>
                    <th className="px-2 py-2 border-b border-zinc-300 dark:border-zinc-700 text-right text-sm">
                      Net APR (%)
                    </th>
                    <th className="px-2 py-2 border-b border-zinc-300 dark:border-zinc-700 text-right text-sm">
                      Katana App APR (%)
                    </th>
                    <th className="px-2 py-2 border-b border-zinc-300 dark:border-zinc-700 text-right text-sm">
                      Fixed Rate APR (%)
                    </th>
                    <th className="px-2 py-2 border-b border-zinc-300 dark:border-zinc-700 text-right text-sm">
                      Bonus APY (%)
                    </th>
                    <th className="px-2 py-2 border-b border-zinc-300 dark:border-zinc-700 text-right text-sm">
                      Extrinsic Yield (%)
                    </th>
                    <th className="px-2 py-2 border-b border-zinc-300 dark:border-zinc-700 text-right text-sm">
                      Native Yield (%)
                    </th>
                    <th className="px-2 py-2 border-b border-zinc-300 dark:border-zinc-700 text-right text-sm font-bold">
                      Total APR (%)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vaults.map((vault) => (
                    <tr key={vault.key}>
                      <td className="px-2 py-2 border-b border-zinc-200 dark:border-zinc-800 text-sm">
                        {vault.name}
                      </td>
                      <td className="px-2 py-2 border-b border-zinc-200 dark:border-zinc-800 text-right text-sm">
                        {vault.netAPR}%
                      </td>
                      <td className="px-2 py-2 border-b border-zinc-200 dark:border-zinc-800 text-right text-sm">
                        {vault.katanaAppRewardsAPR}%
                      </td>
                      <td className="px-2 py-2 border-b border-zinc-200 dark:border-zinc-800 text-right text-sm">
                        {vault.fixedRateKatanaRewards}%
                      </td>
                      <td className="px-2 py-2 border-b border-zinc-200 dark:border-zinc-800 text-right text-sm">
                        {vault.katanaBonusAPY}%
                      </td>
                      <td className="px-2 py-2 border-b border-zinc-200 dark:border-zinc-800 text-right text-sm">
                        {vault.extrinsicYield}%
                      </td>
                      <td className="px-2 py-2 border-b border-zinc-200 dark:border-zinc-800 text-right text-sm">
                        {vault.katanaNativeYield}%
                      </td>
                      <td className="px-2 py-2 border-b border-zinc-200 dark:border-zinc-800 text-right text-sm font-bold">
                        {vault.totalAPR}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <details className="w-full mt-4">
              <summary className="cursor-pointer text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200">
                Show Legacy Fields (for backwards compatibility)
              </summary>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr>
                      <th className="px-4 py-2 border-b border-zinc-300 dark:border-zinc-700 text-sm">
                        Name
                      </th>
                      <th className="px-4 py-2 border-b border-zinc-300 dark:border-zinc-700 text-right text-sm">
                        Legacy Katana Rewards APR (%)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {vaults.map((vault) => (
                      <tr key={vault.key}>
                        <td className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 text-sm">
                          {vault.name}
                        </td>
                        <td className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 text-right text-sm">
                          {vault.katanaRewardsAPR}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>
    </main>
  )
}
