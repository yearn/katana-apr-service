export const KATANA_REWARD_TOKEN_ADDRESSES = [
  '0x6E9C1F88a960fE63387eb4b71BC525a9313d8461', // v2WrappedKat
  '0x3ba1fbC4c3aEA775d335b31fb53778f46FD3a330', // v1WrappedKat
  '0x7F1f4b4b29f5058fA32CC7a97141b8D7e5ABDC2d', // KAT
  '0x0161A31702d6CF715aaa912d64c6A190FD0093aa', // legacy KAT
] as const

export const CANONICAL_KAT_ADDRESS =
  '0x7F1f4b4b29f5058fA32CC7a97141b8D7e5ABDC2d'

const REWARD_TOKEN_ADDRESS_SET = new Set(
  KATANA_REWARD_TOKEN_ADDRESSES.map((address) => address.toLowerCase()),
)

export const isKatanaRewardTokenAddress = (address?: string): boolean => {
  if (!address) {
    return false
  }

  return REWARD_TOKEN_ADDRESS_SET.has(address.toLowerCase())
}

export const getKatanaPriceLookupAddresses = (
  tokenAddress: string,
): string[] => {
  const normalizedAddress = tokenAddress.toLowerCase()
  const canonicalAddress = CANONICAL_KAT_ADDRESS.toLowerCase()

  if (
    !isKatanaRewardTokenAddress(normalizedAddress) ||
    normalizedAddress === canonicalAddress
  ) {
    return [normalizedAddress]
  }

  return [normalizedAddress, canonicalAddress]
}
