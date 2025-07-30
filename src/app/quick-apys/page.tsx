'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'

import type { YearnVault } from '../types/yearn'

type VaultDisplay = {
  key: string
  name: string
  netAPR: string
  katanaRewardsAPR: string
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
        const displayVaults: VaultDisplay[] = vaultsArr.map((vault) => ({
          key: vault.address,
          name: vault.name,
          netAPR:
            vault.apr && typeof vault.apr.netAPR === 'number'
              ? (vault.apr.netAPR * 100).toFixed(2)
              : '-',
          katanaRewardsAPR:
            vault.apr &&
            vault.apr.extra &&
            typeof vault.apr.extra.katanaRewardsAPR === 'number'
              ? (vault.apr.extra.katanaRewardsAPR * 100).toFixed(2)
              : '-',
        }))
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
      <section className="w-full max-w-2xl bg-white/80 dark:bg-zinc-900/80 rounded-2xl shadow-xl p-8 flex flex-col items-center gap-8 border border-zinc-200 dark:border-zinc-800">
        <h1 className="text-3xl font-bold text-center text-zinc-900 dark:text-white tracking-tight mb-2">
          Quick APYs
        </h1>
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
          <table className="w-full text-left border-collapse">
            <thead>
              <tr>
                <th className="px-4 py-2 border-b border-zinc-300 dark:border-zinc-700">
                  Name
                </th>
                <th className="px-4 py-2 border-b border-zinc-300 dark:border-zinc-700 text-right">
                  Net APY (%)
                </th>
                <th className="px-4 py-2 border-b border-zinc-300 dark:border-zinc-700 text-right">
                  Katana Rewards APR (%)
                </th>
              </tr>
            </thead>
            <tbody>
              {vaults.map((vault) => (
                <tr key={vault.key}>
                  <td className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800">
                    {vault.name}
                  </td>
                  <td className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 text-right">
                    {vault.netAPR}%
                  </td>
                  <td className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 text-right">
                    {vault.katanaRewardsAPR}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
