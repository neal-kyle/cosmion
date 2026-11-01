// Money as whole nano-dollars for every sum and comparison: in floating point
// 0.2 − 0.04 − 0.04 − 0.04 − 0.04 isn't 0.04. Nano, not micro, because per-token prices
// go below a millionth of a dollar. Plain USD numbers stay in the ledger and the output.

export function toNano(usd: number): number {
  return Math.round(usd * 1e9)
}

export function toUsd(nano: number): number {
  return nano / 1e9
}
