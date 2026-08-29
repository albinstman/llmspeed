// Typed loader for data/app-data.json — the single build artifact the pipeline emits
// (see docs/data-contract.md). The checked-in JSON is a hand-seeded placeholder with an
// empty `combos` map: until the pipeline produces real per-combo ranges, every prediction
// falls back to the coefficient formulas in calc.ts and shows as "projected".

import raw from '../data/app-data.json'

export type Vendor = 'nvidia' | 'amd' | 'apple' | 'intel' | 'cpu'
export type Backend = 'cuda' | 'metal' | 'rocm' | 'vulkan' | 'cpu'
export type Tier = 'measured' | 'derived' | 'projected' | 'wont_run'

export interface Hw {
  id: string
  name: string
  vendor: Vendor
  backend: Backend
  /** memory capacity in GB (VRAM, or unified memory on Apple/Strix Halo) */
  vram_gb: number
  bandwidth_gbs: number
  tflops_fp16: number
  form_factor: 'desktop' | 'laptop' | 'mini' | 'server'
  status: 'released' | 'announced'
  popularity_rank: number
}

export interface Model {
  id: string
  name: string
  family: string
  total_params_b: number
  /** active params per token — < total for MoE; drives speed, total drives memory */
  active_params_b: number
  /** fp16 KV cache size at 8,192 context tokens */
  kv_gb_per_8k: number
  quants: Record<string, { file_gb: number }>
  context_max: number
  popularity_rank: number
}

export interface Quant {
  id: string
  label: string
}

export interface Coeffs {
  decode_bw_eff: number
  prefill_flops_eff: number
  /** multiplicative throughput derate per 8k tokens of context depth */
  ctx_derate_per_8k: number
}

export interface OffloadCal {
  /** effective system-RAM bandwidth serving CPU-resident weights, GB/s */
  ram_bw_gbs: number
  /** LOO error factors from offload-row calibration — interval width */
  err_q50: number
  err_q80: number
  n_rows: number
}

export interface ComboPred {
  tier: Tier
  /** [lo, hi] tok/s at near-zero context; null for wont_run */
  gen_tps: [number, number] | null
  /** [lo, hi] tok/s per prompt-length preset (same order as prompt_presets); null if unmodeled */
  prefill_tps: [number, number][] | null
}

interface AppData {
  prompt_presets: number[]
  hardware: Hw[]
  models: Model[]
  coefficients: Partial<Record<Backend, Coeffs>>
  offload?: OffloadCal
  /** keyed "hardware_id|model_id|quant" */
  combos: Record<string, ComboPred>
}

const DATA = raw as unknown as AppData

export const HW: Hw[] = [...DATA.hardware].sort((a, b) => a.popularity_rank - b.popularity_rank)
export const MODELS: Model[] = [...DATA.models].sort((a, b) => a.popularity_rank - b.popularity_rank)
export const PROMPT_PRESET_TOKS: number[] = DATA.prompt_presets

export function quantOf(id: string): Quant {
  return { id, label: id.toUpperCase() }
}

/** quants this model actually has files for, smallest first */
export function quantsFor(m: Model): Quant[] {
  return Object.keys(m.quants)
    .sort((a, b) => m.quants[a].file_gb - m.quants[b].file_gb)
    .map(quantOf)
}

const FALLBACK_COEFFS: Coeffs = { decode_bw_eff: 0.5, prefill_flops_eff: 0.25, ctx_derate_per_8k: 0.92 }

export function coeffs(backend: Backend): Coeffs {
  return DATA.coefficients[backend] ?? FALLBACK_COEFFS
}

export const OFFLOAD: OffloadCal = DATA.offload ?? { ram_bw_gbs: 55, err_q50: 1.5, err_q80: 2.0, n_rows: 0 }

export function combo(hwId: string, modelId: string, quantId: string): ComboPred | undefined {
  return DATA.combos[`${hwId}|${modelId}|${quantId}`]
}

// Share URLs minted before the pipeline-style catalog ids existed. Catalog ids are
// permanent per the data contract, so this map only ever grows.
const LEGACY_HW: Record<string, string> = {
  rtx3060: 'rtx-3060', rtx4070: 'rtx-4070', rtx4070ts: 'rtx-4070-ti-super',
  rtx4090: 'rtx-4090', rtx5090: 'rtx-5090',
  m2pro: 'm2-pro-16gb', m4pro: 'm4-pro-24gb', m3max: 'm3-max-48gb', m4max: 'm4-max-128gb',
  rx7900xt: 'rx-7900-xt', rx7900xtx: 'rx-7900-xtx',
  a100: 'a100-80gb', h100: 'h100-80gb',
}
const LEGACY_MODEL: Record<string, string> = {
  'llama31-8b': 'llama-3.1-8b', 'llama33-70b': 'llama-3.3-70b',
  'qwen25-7b': 'qwen-2.5-7b', 'qwen25-32b': 'qwen-2.5-32b', 'qwen25-72b': 'qwen-2.5-72b',
  mistral7b: 'mistral-7b', mixtral: 'mixtral-8x7b',
  'r1-14b': 'deepseek-r1-14b', 'r1-32b': 'deepseek-r1-32b', phi4: 'phi-4-14b',
}
const LEGACY_QUANT: Record<string, string> = { q4: 'q4_k_m', q8: 'q8_0', f16: 'fp16' }

export const canonHw = (id: string) => LEGACY_HW[id] ?? id
export const canonModel = (id: string) => LEGACY_MODEL[id] ?? id
export const canonQuant = (id: string) => LEGACY_QUANT[id] ?? id

export interface Preset {
  label: string
  tok: number
  text: string
}

// Prompt texts are pure UI; the token depths come from app-data.json so the
// pipeline's prefill presets and the picker always agree.
const PRESET_UI: { label: string; text: string }[] = [
  { label: 'Short chat', text: "What's the practical difference between RAM and VRAM for running local models? Keep it brief." },
  { label: 'Email draft', text: "Draft a polite email to my landlord about the broken heating. Notes: reported it twice already (Oct 12, Oct 19), no response. Lease says repairs within 14 days. I want a firm but friendly tone, mention I'll escalate to the tenancy board if not fixed by end of month. Sign as Sam." },
  { label: 'Code file', text: "Review this file for bugs and suggest fixes:\n\nfunction debounce(fn, wait) {\n  let t;\n  return (...args) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(args), wait);\n  };\n}\n\nasync function fetchUsers(ids) {\n  const out = [];\n  ids.forEach(async id => {\n    const r = await fetch('/api/users/' + id);\n    out.push(r.json());\n  });\n  return out;\n}\n\n… [file continues — ~1,800 tokens total]" },
  { label: '20-page doc', text: "Summarize the key obligations, deadlines, and termination clauses in this services agreement:\n\nMASTER SERVICES AGREEMENT — This Agreement is entered into as of the Effective Date by and between the Client and the Provider. 1. SERVICES. Provider shall perform the services described in each Statement of Work…\n\n… [document continues — ~12,500 tokens total]" },
]

export const PRESETS: Preset[] = PRESET_UI.map((p, i) => ({ ...p, tok: PROMPT_PRESET_TOKS[i] ?? [42, 290, 1800, 12500][i] }))

export const RESP: string[] = [
  "RAM is your system's general-purpose working memory — the CPU uses it for everything. VRAM is memory that lives on the graphics card, wired directly to the GPU with much higher bandwidth. For local models that distinction is the whole game: the model's weights have to be read once per generated token, so whichever memory holds the weights sets your speed. Weights in VRAM stream at hundreds of GB/s; spill into system RAM and you drop to a tenth of that. Practical rule: buy enough VRAM to hold the model you actually want to run, at the quantization you can tolerate. Speed is mostly memory bandwidth, capacity decides what fits.",
  "Here's a draft you can send:\n\nSubject: Heating repair — follow-up and next steps\n\nHi [Landlord's name],\n\nI'm writing to follow up on the broken heating in my unit, which I reported on October 12 and again on October 19 without a response. As the weather is getting colder, this is becoming urgent.\n\nPer the lease, repairs are to be completed within 14 days of notice — we're now well past that window from my first report. I'd genuinely prefer to resolve this directly: could you confirm by Friday when a repair visit will happen?\n\nIf the heating isn't fixed by the end of the month, I'll need to escalate the matter to the tenancy board, which I'd rather avoid.\n\nThanks for your attention to this.\n\nBest,\nSam",
  "Two real bugs here.\n\n1. debounce drops the spread. You collect ...args but then call fn(args) — that passes a single array instead of the original arguments. Fix: fn(...args). Also consider preserving `this` by using a function expression and fn.apply(this, args) if it will decorate methods.\n\n2. fetchUsers returns before any fetch resolves. forEach ignores the async callback's promise, so `out` is empty (or partially filled, later — a race). Also r.json() is pushed as a promise, never awaited. Fix:\n\nasync function fetchUsers(ids) {\n  return Promise.all(ids.map(async id => {\n    const r = await fetch('/api/users/' + id);\n    if (!r.ok) throw new Error('user ' + id + ': ' + r.status);\n    return r.json();\n  }));\n}\n\nThat runs requests concurrently, preserves order, and surfaces HTTP errors instead of silently succeeding. If the id list can be large, batch with a small concurrency limit to avoid hammering the API.",
  "Summary of key obligations, deadlines, and termination provisions:\n\nProvider obligations. Perform services per each Statement of Work to professional standards; assign qualified personnel; deliver work product on the schedule set in the applicable SOW; maintain confidentiality of Client materials indefinitely for trade secrets and five years for other confidential information.\n\nClient obligations. Provide timely access to systems, data, and personnel reasonably needed; review and accept or reject deliverables within 10 business days (silence is deemed acceptance); pay undisputed invoices net-30 from receipt, with 1.5% monthly late interest.\n\nKey deadlines. Deliverable review: 10 business days. Invoice payment: 30 days. Cure period for material breach: 30 days from written notice. Insurance certificates due within 15 days of signing.\n\nTermination. Either party may terminate for uncured material breach after the 30-day cure window. Client may terminate any SOW for convenience on 30 days' written notice, paying for work performed plus non-cancellable commitments. Provider may suspend work if undisputed invoices are 45+ days overdue, after 10 days' notice. Sections on confidentiality, IP assignment, and limitation of liability survive termination.",
]

export const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
