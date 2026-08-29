import { coeffs, combo, PROMPT_PRESET_TOKS, type ComboPred, type Hw, type Model, type Quant } from './data'

export type Fit = 'fits' | 'partial' | 'no'
export type Conf = 'measured' | 'derived' | 'projected' | null

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
  /** prefill speed, tok/s */
  pre: number
  /** time to first token, s */
  ttft: number
  conf: Conf
  /** decode bandwidth efficiency (coefficient path) */
  eff: number
  /** active weight bytes read per token, GB */
  aw: number
  /** the range came from a pipeline per-combo prediction, not the coefficient formula */
  fromCombo: boolean
}

// Fallback bytes/param per quant, used only when a config references a quant the
// model has no file for (e.g. a stale share link); real sizes come from app-data.
const FALLBACK_BPP: Record<string, number> = { q4_k_m: 0.61, q8_0: 1.06, fp16: 2.0 }

// log-linear interpolation of the combo's per-preset prefill midpoints over context depth
function comboPrefill(cb: ComboPred | undefined, ctx: number): number | null {
  if (!cb || !cb.prefill_tps || !cb.prefill_tps.length) return null
  const n = Math.min(cb.prefill_tps.length, PROMPT_PRESET_TOKS.length)
  const mids = cb.prefill_tps.slice(0, n).map(([a, b]) => (a + b) / 2)
  const toks = PROMPT_PRESET_TOKS.slice(0, n)
  if (ctx <= toks[0]) return mids[0]
  for (let i = 1; i < n; i++) {
    if (ctx <= toks[i]) {
      const t = (Math.log(ctx) - Math.log(toks[i - 1])) / (Math.log(toks[i]) - Math.log(toks[i - 1]))
      return mids[i - 1] + (mids[i] - mids[i - 1]) * t
    }
  }
  return mids[n - 1]
}

export function calc(hw: Hw, m: Model, q: Quant, ctx: number): CalcResult {
  const co = coeffs(hw.backend)
  const w = m.quants[q.id] ? m.quants[q.id].file_gb : m.total_params_b * (FALLBACK_BPP[q.id] ?? 2)
  const kv = Math.max(0.15, m.kv_gb_per_8k * (ctx / 8192))
  const usable = hw.vendor === 'apple' ? hw.vram_gb * 0.75 : hw.vram_gb * 0.93
  const total = w + kv + 0.6
  const fit: Fit = total <= usable ? 'fits'
    : (hw.vendor !== 'apple' && hw.form_factor !== 'server' && total <= usable * 2.4 ? 'partial' : 'no')
  const derate = Math.pow(co.ctx_derate_per_8k, ctx / 8192)
  const aw = w * (m.active_params_b / m.total_params_b)
  const cb = combo(hw.id, m.id, q.id)

  let lo: number, hi: number, conf: Conf, fromCombo = false
  if (cb && cb.gen_tps && cb.tier !== 'wont_run') {
    lo = cb.gen_tps[0] * derate
    hi = cb.gen_tps[1] * derate
    conf = cb.tier
    fromCombo = true
  } else {
    const b = (hw.bandwidth_gbs * co.decode_bw_eff / aw) * derate
    lo = b * 0.85
    hi = b * 1.15
    conf = 'projected'
  }
  if (fit === 'partial') {
    const r = usable / total
    const pen = Math.max(0.05, r * r * 0.45)
    lo *= pen; hi *= pen
    conf = 'projected'
  }
  if (hw.status === 'announced') conf = 'projected'
  const base = (lo + hi) / 2

  let pre = comboPrefill(cb, ctx) ?? (hw.tflops_fp16 * 1000 * co.prefill_flops_eff / (2 * m.active_params_b)) * derate
  if (fit === 'partial') pre *= 0.5
  const ttft = ctx / pre + (fit === 'partial' ? 1.2 : 0.3)

  if (fit === 'no') conf = null
  return { w, kv, usable, total, fit, base, lo, hi, pre, ttft, conf, eff: co.decode_bw_eff, aw, fromCombo }
}

export function fmt(x: number): string {
  return x >= 10 ? Math.round(x).toString() : x.toFixed(1)
}
