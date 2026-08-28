import type { Hw, Model, Quant } from './data'

export type Fit = 'fits' | 'partial' | 'no'
export type Conf = 'measured' | 'derived' | 'estimated' | null

export interface CalcResult {
  /** weight memory, GB */
  w: number
  /** KV cache memory, GB */
  kv: number
  /** usable device memory, GB */
  usable: number
  /** total memory needed, GB */
  total: number
  fit: Fit
  /** decode speed, tok/s */
  base: number
  lo: number
  hi: number
  /** time to first token, s */
  ttft: number
  conf: Conf
}

export function calc(hw: Hw, m: Model, q: Quant, ctx: number): CalcResult {
  const w = (m.p * q.bpw) / 8 * 1.05
  const aW = (m.a * q.bpw) / 8 * 1.05
  const kv = Math.max(0.15, (m.p / 8) * (ctx / 8192))
  const usable = hw.fam === 'apple' ? hw.vram * 0.75 : hw.vram * 0.93
  const total = w + kv + 0.6
  const fit: Fit = total <= usable ? 'fits' : (hw.fam !== 'apple' && hw.fam !== 'dc' && total <= usable * 2.4 ? 'partial' : 'no')
  let base = (hw.bw * hw.eff) / aW
  if (fit === 'partial') {
    const r = usable / total
    base *= Math.max(0.05, r * r * 0.45)
  }
  const lo = base * 0.88
  const hi = base * 1.12
  const pre = base * (hw.fam === 'apple' ? 4 : 12) * (fit === 'partial' ? 0.5 : 1)
  const ttft = ctx / pre + (fit === 'partial' ? 1.2 : 0.3)
  let conf: Conf = null
  if (fit === 'fits') {
    const small = m.p <= 15
    conf = (hw.meas && small && q.id === 'q4') ? 'measured' : (hw.meas || small) ? 'derived' : 'estimated'
  } else if (fit === 'partial') conf = 'estimated'
  return { w, kv, usable, total, fit, base, lo, hi, ttft, conf }
}

export function fmt(x: number): string {
  return x >= 10 ? Math.round(x).toString() : x.toFixed(1)
}
