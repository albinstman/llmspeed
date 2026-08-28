// Placeholder dataset ported from the design mockup.
// TODO: replace with curated JSON assets (hardware, models, benchmarks) once sourcing is decided.

export interface Hw {
  id: string
  name: string
  /** memory capacity in GB (VRAM, or unified memory on Apple) */
  vram: number
  /** memory bandwidth in GB/s */
  bw: number
  fam: 'nvidia' | 'apple' | 'amd' | 'dc'
  /** effective fraction of peak bandwidth reached during decode */
  eff: number
  /** 1 = we have real measurements for this device */
  meas?: 1
  pop: number
}

export interface Model {
  id: string
  name: string
  /** total params, billions */
  p: number
  /** active params per token, billions (differs from p for MoE) */
  a: number
  pop: number
}

export interface Quant {
  id: string
  label: string
  /** bits per weight */
  bpw: number
}

export interface Preset {
  label: string
  tok: number
  text: string
}

export const HW: Hw[] = [
  { id: 'rtx3060', name: 'RTX 3060 12GB', vram: 12, bw: 360, fam: 'nvidia', eff: 0.55, meas: 1, pop: 1 },
  { id: 'rtx4070', name: 'RTX 4070 12GB', vram: 12, bw: 504, fam: 'nvidia', eff: 0.55, pop: 3 },
  { id: 'rtx4070ts', name: 'RTX 4070 Ti Super 16GB', vram: 16, bw: 672, fam: 'nvidia', eff: 0.55, pop: 6 },
  { id: 'rtx4090', name: 'RTX 4090 24GB', vram: 24, bw: 1008, fam: 'nvidia', eff: 0.55, meas: 1, pop: 2 },
  { id: 'rtx5090', name: 'RTX 5090 32GB', vram: 32, bw: 1792, fam: 'nvidia', eff: 0.5, meas: 1, pop: 8 },
  { id: 'm2pro', name: 'MacBook M2 Pro 16GB', vram: 16, bw: 200, fam: 'apple', eff: 0.7, pop: 5 },
  { id: 'm4pro', name: 'MacBook M4 Pro 24GB', vram: 24, bw: 273, fam: 'apple', eff: 0.7, pop: 4 },
  { id: 'm3max', name: 'MacBook M3 Max 48GB', vram: 48, bw: 400, fam: 'apple', eff: 0.7, meas: 1, pop: 9 },
  { id: 'm4max', name: 'Mac Studio M4 Max 128GB', vram: 128, bw: 546, fam: 'apple', eff: 0.7, pop: 10 },
  { id: 'rx7900xt', name: 'RX 7900 XT 20GB', vram: 20, bw: 800, fam: 'amd', eff: 0.42, pop: 11 },
  { id: 'rx7900xtx', name: 'RX 7900 XTX 24GB', vram: 24, bw: 960, fam: 'amd', eff: 0.42, pop: 7 },
  { id: 'a100', name: 'A100 80GB (cloud)', vram: 80, bw: 2039, fam: 'dc', eff: 0.6, pop: 12 },
  { id: 'h100', name: 'H100 80GB (cloud)', vram: 80, bw: 3350, fam: 'dc', eff: 0.6, pop: 13 },
]

export const MODELS: Model[] = [
  { id: 'llama31-8b', name: 'Llama 3.1 8B', p: 8, a: 8, pop: 1 },
  { id: 'llama33-70b', name: 'Llama 3.3 70B', p: 70, a: 70, pop: 8 },
  { id: 'qwen25-7b', name: 'Qwen 2.5 7B', p: 7.6, a: 7.6, pop: 3 },
  { id: 'qwen25-32b', name: 'Qwen 2.5 32B', p: 32, a: 32, pop: 6 },
  { id: 'qwen25-72b', name: 'Qwen 2.5 72B', p: 72, a: 72, pop: 9 },
  { id: 'mistral7b', name: 'Mistral 7B', p: 7.2, a: 7.2, pop: 2 },
  { id: 'mixtral', name: 'Mixtral 8×7B', p: 46.7, a: 12.9, pop: 10 },
  { id: 'r1-14b', name: 'DeepSeek R1 Distill 14B', p: 14.8, a: 14.8, pop: 5 },
  { id: 'r1-32b', name: 'DeepSeek R1 Distill 32B', p: 32.8, a: 32.8, pop: 7 },
  { id: 'phi4', name: 'Phi-4 14B', p: 14.7, a: 14.7, pop: 4 },
]

export const QUANTS: Quant[] = [
  { id: 'q4', label: 'Q4_K_M', bpw: 4.6 },
  { id: 'q8', label: 'Q8_0', bpw: 8.5 },
  { id: 'f16', label: 'FP16', bpw: 16 },
]

export const PRESETS: Preset[] = [
  { label: 'Short chat', tok: 42, text: "What's the practical difference between RAM and VRAM for running local models? Keep it brief." },
  { label: 'Email draft', tok: 290, text: "Draft a polite email to my landlord about the broken heating. Notes: reported it twice already (Oct 12, Oct 19), no response. Lease says repairs within 14 days. I want a firm but friendly tone, mention I'll escalate to the tenancy board if not fixed by end of month. Sign as Sam." },
  { label: 'Code file', tok: 1800, text: "Review this file for bugs and suggest fixes:\n\nfunction debounce(fn, wait) {\n  let t;\n  return (...args) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(args), wait);\n  };\n}\n\nasync function fetchUsers(ids) {\n  const out = [];\n  ids.forEach(async id => {\n    const r = await fetch('/api/users/' + id);\n    out.push(r.json());\n  });\n  return out;\n}\n\n… [file continues — ~1,800 tokens total]" },
  { label: '20-page doc', tok: 12500, text: "Summarize the key obligations, deadlines, and termination clauses in this services agreement:\n\nMASTER SERVICES AGREEMENT — This Agreement is entered into as of the Effective Date by and between the Client and the Provider. 1. SERVICES. Provider shall perform the services described in each Statement of Work…\n\n… [document continues — ~12,500 tokens total]" },
]

export const RESP: string[] = [
  "RAM is your system's general-purpose working memory — the CPU uses it for everything. VRAM is memory that lives on the graphics card, wired directly to the GPU with much higher bandwidth. For local models that distinction is the whole game: the model's weights have to be read once per generated token, so whichever memory holds the weights sets your speed. Weights in VRAM stream at hundreds of GB/s; spill into system RAM and you drop to a tenth of that. Practical rule: buy enough VRAM to hold the model you actually want to run, at the quantization you can tolerate. Speed is mostly memory bandwidth, capacity decides what fits.",
  "Here's a draft you can send:\n\nSubject: Heating repair — follow-up and next steps\n\nHi [Landlord's name],\n\nI'm writing to follow up on the broken heating in my unit, which I reported on October 12 and again on October 19 without a response. As the weather is getting colder, this is becoming urgent.\n\nPer the lease, repairs are to be completed within 14 days of notice — we're now well past that window from my first report. I'd genuinely prefer to resolve this directly: could you confirm by Friday when a repair visit will happen?\n\nIf the heating isn't fixed by the end of the month, I'll need to escalate the matter to the tenancy board, which I'd rather avoid.\n\nThanks for your attention to this.\n\nBest,\nSam",
  "Two real bugs here.\n\n1. debounce drops the spread. You collect ...args but then call fn(args) — that passes a single array instead of the original arguments. Fix: fn(...args). Also consider preserving `this` by using a function expression and fn.apply(this, args) if it will decorate methods.\n\n2. fetchUsers returns before any fetch resolves. forEach ignores the async callback's promise, so `out` is empty (or partially filled, later — a race). Also r.json() is pushed as a promise, never awaited. Fix:\n\nasync function fetchUsers(ids) {\n  return Promise.all(ids.map(async id => {\n    const r = await fetch('/api/users/' + id);\n    if (!r.ok) throw new Error('user ' + id + ': ' + r.status);\n    return r.json();\n  }));\n}\n\nThat runs requests concurrently, preserves order, and surfaces HTTP errors instead of silently succeeding. If the id list can be large, batch with a small concurrency limit to avoid hammering the API.",
  "Summary of key obligations, deadlines, and termination provisions:\n\nProvider obligations. Perform services per each Statement of Work to professional standards; assign qualified personnel; deliver work product on the schedule set in the applicable SOW; maintain confidentiality of Client materials indefinitely for trade secrets and five years for other confidential information.\n\nClient obligations. Provide timely access to systems, data, and personnel reasonably needed; review and accept or reject deliverables within 10 business days (silence is deemed acceptance); pay undisputed invoices net-30 from receipt, with 1.5% monthly late interest.\n\nKey deadlines. Deliverable review: 10 business days. Invoice payment: 30 days. Cure period for material breach: 30 days from written notice. Insurance certificates due within 15 days of signing.\n\nTermination. Either party may terminate for uncured material breach after the 30-day cure window. Client may terminate any SOW for convenience on 30 days' written notice, paying for work performed plus non-cancellable commitments. Provider may suspend work if undisputed invoices are 45+ days overdue, after 10 days' notice. Sections on confidentiality, IP assignment, and limitation of liability survive termination.",
]

export const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
