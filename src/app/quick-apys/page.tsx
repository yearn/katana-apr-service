'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'

import type { YearnVault } from '../types/yearn'

type StrategyDisplay = {
  key: string
  name: string
  status: string
  netAPR: string
  strategyRewardsAPR: string
}

type VaultDisplay = {
  key: string
  name: string
  monthlyNetAPY: string
  katanaAppRewardsAPR: string
  fixedRateKatanaRewards: string
  totalAPR: string
  strategies: StrategyDisplay[]
}

const formatPercent = (value: number | undefined): string =>
  ((value || 0) * 100).toFixed(2)

const parseVaultResponse = (data: unknown): YearnVault[] => {
  if (
    data &&
    typeof data === 'object' &&
    'vaults' in data &&
    data.vaults !== undefined
  ) {
    if (Array.isArray(data.vaults)) {
      return data.vaults as YearnVault[]
    }

    if (data.vaults && typeof data.vaults === 'object') {
      return Object.values(data.vaults as Record<string, YearnVault>)
    }
  }

  if (Array.isArray(data)) {
    return data as YearnVault[]
  }

  if (data && typeof data === 'object') {
    return Object.values(data as Record<string, YearnVault>)
  }

  return []
}

export default function QuickAPYs(): React.ReactElement {
  const [vaults, setVaults] = useState<VaultDisplay[]>([])
  const [expandedVaults, setExpandedVaults] = useState<Record<string, boolean>>(
    {},
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/vaults')
      .then((res) => {
        if (!res.ok) {
          throw new Error('Failed to fetch vaults')
        }

        return res.json()
      })
      .then((data) => {
        const vaultsArr = parseVaultResponse(data)
        const displayVaults: VaultDisplay[] = vaultsArr.map((vault) => {
          const monthlyNetAPY = vault.apr?.netAPR || 0
          const katanaAppRewardsAPR = vault.apr?.extra?.katanaAppRewardsAPR || 0
          const fixedRateKatanaRewards =
            vault.apr?.extra?.fixedRateKatanaRewards || 0
          const totalAPR =
            monthlyNetAPY + katanaAppRewardsAPR + fixedRateKatanaRewards

          return {
            key: vault.address,
            name: vault.name,
            monthlyNetAPY: formatPercent(monthlyNetAPY),
            katanaAppRewardsAPR: formatPercent(katanaAppRewardsAPR),
            fixedRateKatanaRewards: formatPercent(fixedRateKatanaRewards),
            totalAPR: formatPercent(totalAPR),
            strategies: (vault.strategies || []).map((strategy) => ({
              key: strategy.address,
              name: strategy.name,
              status: strategy.status || 'unknown',
              netAPR: formatPercent(strategy.netAPR),
              strategyRewardsAPR: formatPercent(strategy.strategyRewardsAPR),
            })),
          }
        })

        setVaults(displayVaults)
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  const toggleVault = (vaultKey: string): void => {
    setExpandedVaults((current) => ({
      ...current,
      [vaultKey]: !current[vaultKey],
    }))
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-start bg-gradient-to-b from-white to-gray-100 px-4 py-6 dark:from-[#18181b] dark:to-[#23232a]">
      <section className="flex min-h-[calc(100vh-3rem)] w-full max-w-6xl flex-col items-center gap-8 rounded-2xl bg-white/80 p-8 shadow-xl dark:bg-zinc-900/80">
        <h1 className="mb-2 text-center text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
          Quick APYs
        </h1>
        <p className="mb-4 text-center text-sm text-zinc-600 dark:text-zinc-400">
          Vault-level APR summary with expandable strategy-level KAT rewards.
        </p>
        <Link
          href="/"
          className="mb-4 text-blue-600 underline dark:text-blue-400"
        >
          ← Back to Home
        </Link>
        {loading ? (
          <p className="text-zinc-700 dark:text-zinc-300">Loading...</p>
        ) : error ? (
          <p className="text-red-600 dark:text-red-400">{error}</p>
        ) : (
          <>
            <div className="w-full overflow-x-auto">
              <table className="min-w-[980px] w-full table-fixed border-collapse text-left">
                <colgroup>
                  <col className="w-[40%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="whitespace-nowrap px-2 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                      Vault
                    </th>
                    <th className="whitespace-nowrap px-1 py-2 text-right text-sm text-zinc-500 dark:text-zinc-400">
                      monthlyNetAPY (%)
                    </th>
                    <th className="whitespace-nowrap px-1 py-2 text-right text-sm text-zinc-500 dark:text-zinc-400">
                      KAT Strategy APR (%)
                    </th>
                    <th className="whitespace-nowrap px-1 py-2 text-right text-sm text-zinc-500 dark:text-zinc-400">
                      KAT Vault Bonus APR (%)
                    </th>
                    <th className="whitespace-nowrap px-1 py-2 text-right text-sm font-bold text-zinc-500 dark:text-zinc-400">
                      Total APR (%)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vaults.map((vault) => {
                    const isExpanded = expandedVaults[vault.key] || false

                    return (
                      <React.Fragment key={vault.key}>
                        <tr className="align-top">
                          <td className="px-2 py-3 text-sm">
                            <button
                              type="button"
                              onClick={() => toggleVault(vault.key)}
                              className="flex w-full items-center gap-3 text-left text-zinc-900 dark:text-zinc-100"
                              aria-expanded={isExpanded}
                            >
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-zinc-100 text-xs dark:bg-zinc-800">
                                {isExpanded ? '−' : '+'}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">
                                  {vault.name}
                                </span>
                                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                                  {vault.strategies.length} strategies
                                </span>
                              </span>
                            </button>
                          </td>
                          <td className="px-1 py-3 text-right text-sm tabular-nums">
                            {vault.monthlyNetAPY}%
                          </td>
                          <td className="px-1 py-3 text-right text-sm tabular-nums">
                            {vault.katanaAppRewardsAPR}%
                          </td>
                          <td className="px-1 py-3 text-right text-sm tabular-nums">
                            {vault.fixedRateKatanaRewards}%
                          </td>
                          <td className="px-1 py-3 text-right text-sm font-bold tabular-nums">
                            {vault.totalAPR}%
                          </td>
                        </tr>
                        {isExpanded ? (
                          vault.strategies.length > 0 ? (
                            vault.strategies.map((strategy) => (
                              <tr
                                key={strategy.key}
                                className="text-zinc-700 dark:text-zinc-300"
                              >
                                <td className="px-2 py-2 text-sm">
                                  <div className="flex items-center gap-3 pl-9">
                                    <span
                                      className={`h-2 w-2 flex-none rounded-full ${
                                        strategy.status === 'active'
                                          ? 'bg-emerald-500'
                                          : 'bg-zinc-400 dark:bg-zinc-600'
                                      }`}
                                      aria-hidden="true"
                                    />
                                    <span className="truncate">
                                      {strategy.name}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-1 py-2 text-right text-sm font-medium tabular-nums text-zinc-800 dark:text-zinc-200">
                                  {strategy.netAPR}%
                                </td>
                                <td className="px-1 py-2 text-right text-sm tabular-nums">
                                  {strategy.strategyRewardsAPR}%
                                </td>
                                <td className="px-1 py-2 text-right text-sm text-zinc-400 dark:text-zinc-600">
                                  -
                                </td>
                                <td className="px-1 py-2 text-right text-sm text-zinc-400 dark:text-zinc-600">
                                  -
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td className="px-2 py-2 pl-11 text-sm text-zinc-500 dark:text-zinc-400">
                                No strategies available for this vault.
                              </td>
                              <td className="px-2 py-2" />
                              <td className="px-2 py-2" />
                              <td className="px-2 py-2" />
                              <td className="px-2 py-2" />
                            </tr>
                          )
                        ) : null}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

          </>
        )}
      </section>
    </main>
  )
}
