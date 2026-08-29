import { Component, type ComponentChild } from 'preact'
import { HW, MODELS, OFFLOAD, PRESETS, RESP, SPIN, quantOf, quantsFor, canonHw, canonModel, canonQuant, type Hw, type Model, type Quant } from './data'
import { calc, fmt, type CalcResult, type Fit } from './calc'

// Design knobs — values match the mockup's exported defaults (Tokens Simulator v3).
const CONFIG = {
  feelEffect: 'gradient' as 'retype' | 'wave' | 'shimmer' | 'breathe' | 'gradient' | 'sparks' | 'none',
  resetIcon: 'home' as 'home' | 'plus' | 'new-chat' | 'refresh',
  shareStyle: 'plain' as 'coral-solid' | 'coral-outline' | 'ink-solid' | 'plain',
  comparePlacement: 'config-row' as 'stats' | 'config-row' | 'composer' | 'navbar',
  runButtonColor: 'coral' as 'black' | 'coral' | 'graphite',
  fitBadgeStyle: 'hidden' as 'chip' | 'minimal' | 'solid' | 'meter' | 'hidden',
  showCompare: true,
  showShare: false,
}

interface Cfg { hw: string; model: string; quant: string }
interface Msg { role: 'user' | 'assistant'; text: string; meta?: string }
interface LaneSt { phase: 'norun' | 'prefill' | 'stream' | 'done'; prefillT: number; text: string; liveTok: number; finishT: number; winner: boolean }
interface St {
  cfgs: Cfg[]; preset: number; custom: string | null; phase: 'idle' | 'running' | 'done'
  streamText: string; liveTok: number; prefillT: number; breakdownOpen: boolean; history: Msg[]
  dd: string | null; tip: string | null; hwSort: 'pop' | 'ram'; modelSort: 'pop' | 'size'
  lanes: LaneSt[]; racePrompt: string; shared: boolean; dark: boolean
  feelPhase: 'type' | 'hold' | 'erase'; feelN: number; feelT: number
  isMobile: boolean; cfgOpen: boolean; composerH: number
  /** a run=1 share link was opened: render the conversation view immediately, run() fires shortly */
  pendingShare: boolean
}
interface RunLane { hw: Hw; m: Model; q: Quant; c: CalcResult; norun: boolean; acc: number; i: number; done: boolean; streamStarted: boolean; liveTok: number; finishT: number }

type OptRow =
  | { hdr: true; label: string; hdrStyle: string; dotStyle: string }
  | { hdr: false; name: string; meta: string; sel: boolean; pick: () => void; style: string }

const EMPTY_LANE: LaneSt = { phase: 'prefill', prefillT: 0, text: '', liveTok: 0, finishT: 0, winner: false }

export class App extends Component<{}, St> {
  state: St = (() => {
    const base: St = {
      cfgs: [{ hw: 'rtx-4090', model: 'llama-3.1-8b', quant: 'q4_k_m' }], preset: 0, custom: null, phase: 'idle',
      streamText: '', liveTok: 0, prefillT: 0, breakdownOpen: false, history: [],
      dd: null, tip: null, hwSort: 'pop', modelSort: 'pop', lanes: [], racePrompt: '', shared: false, dark: false,
      feelPhase: 'type', feelN: 0, feelT: 0,
      isMobile: typeof matchMedia !== 'undefined' && matchMedia('(max-width:640px)').matches, cfgOpen: false, composerH: 140,
      pendingShare: false,
    }
    // share links are applied before the first render so the hero never flashes
    try {
      const qs = new URLSearchParams(location.search)
      if (qs.has('hw') || qs.has('model')) {
        const hws = (qs.get('hw') || '').split(',').map(canonHw), models = (qs.get('model') || '').split(',').map(canonModel), quants = (qs.get('quant') || '').split(',').map(canonQuant)
        const n = Math.min(2, Math.max(hws.length, models.length, quants.length))
        const cfgs: Cfg[] = []
        for (let i = 0; i < n; i++) {
          const cfg = { hw: hws[i] || hws[0], model: models[i] || models[0], quant: quants[i] || quants[0] }
          const cm = MODELS.find(m => m.id === cfg.model)
          if (HW.some(h => h.id === cfg.hw) && cm && cm.quants[cfg.quant]) cfgs.push(cfg)
        }
        if (cfgs.length) base.cfgs = cfgs
        const p = qs.get('preset')
        if (p !== null && PRESETS[+p]) base.preset = +p
        const t = qs.get('prompt')
        if (t) base.custom = t.slice(0, 2000)
        if (qs.get('run') === '1') {
          base.pendingShare = true
          const text = base.custom !== null ? base.custom : PRESETS[base.preset].text
          if (base.cfgs.length === 1) base.history = [{ role: 'user', text }]
          else base.racePrompt = text
        }
      }
    } catch (e) { }
    return base
  })()

  timer?: ReturnType<typeof setInterval>
  feelTimer?: ReturnType<typeof setInterval>
  runCfg: { lanes: RunLane[]; words: string[]; tokIn: number; text: string } | null = null
  t0 = 0
  _last = 0
  _winner: RunLane | null = null
  _shT?: ReturnType<typeof setTimeout>
  _doc?: () => void
  _scrollQueued = false
  _sc: HTMLElement | null = null
  _mq?: MediaQueryList
  _mqL?: () => void
  _root: HTMLElement | null = null
  _rootRef = (el: HTMLElement | null) => { this._root = el }
  // clamps a just-opened dropdown/tooltip into the viewport so it can't cause horizontal scroll
  _menuRef = (el: HTMLElement | null) => {
    if (!el) return
    const pad = 8
    const r = el.getBoundingClientRect()
    let dx = 0
    if (r.right > window.innerWidth - pad) dx = window.innerWidth - pad - r.right
    if (r.left + dx < pad) dx = pad - r.left
    if (dx) el.style.marginLeft = dx + 'px'
  }
  _syncScroll = (hero: boolean) => {
    const had = document.documentElement.classList.contains('doc-scroll')
    document.documentElement.classList.toggle('doc-scroll', hero)
    if (had && !hero) window.scrollTo(0, 0)
  }
  heroNow() {
    const s = this.state
    const busy = s.phase === 'running'
    const raceActive = s.cfgs.length > 1 && (busy || s.phase === 'done') && s.lanes.length > 1
    return !raceActive && s.history.length === 0 && !busy && !s.pendingShare
  }
  // a plain class (NOT data-dark: that would pull html/body into the [data-dark] transition rules
  // and cause chained/laggy fades) themes the document — safe areas and Safari's toolbar tint
  _syncDark = (d: boolean) => {
    document.documentElement.classList.toggle('theme-dark', d)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', d ? '#111114' : '#ffffff')
  }
  _vv?: () => void
  _ro?: ResizeObserver
  // stable ref callback: measures the floating composer so the conversation gets matching bottom padding
  _compRef = (el: HTMLElement | null) => {
    if (this._ro) { this._ro.disconnect(); this._ro = undefined }
    if (el) {
      this._ro = new ResizeObserver(() => {
        const h = el.offsetHeight
        if (Math.abs(h - this.state.composerH) > 1) this.setState({ composerH: h })
      })
      this._ro.observe(el)
    }
  }

  resolve(cfg: Cfg) {
    return { hw: HW.find(h => h.id === cfg.hw)!, m: MODELS.find(m => m.id === cfg.model)!, q: quantOf(cfg.quant) }
  }
  promptTokens() {
    const s = this.state
    return s.custom !== null ? Math.max(8, Math.ceil(s.custom.length / 3.6)) : PRESETS[s.preset].tok
  }
  isCompare() { return this.state.cfgs.length > 1 }

  groupOpts<T>(sorted: T[], fitOf: (x: T) => Fit, mapFn: (x: T) => { name: string; meta: string; sel: boolean; pick: () => void }): OptRow[] {
    const groups: Record<Fit, T[]> = { fits: [], partial: [], no: [] }
    sorted.forEach(x => groups[fitOf(x)].push(x))
    const meta: Record<Fit, [string, string]> = { fits: ['Runs comfortably', 'oklch(0.55 0.15 155)'], partial: ['Partial offload · slow', 'oklch(0.68 0.13 85)'], no: ["Won't run", 'oklch(0.55 0.19 25)'] }
    const out: OptRow[] = []
    for (const g of ['fits', 'partial', 'no'] as Fit[]) {
      if (!groups[g].length) continue
      out.push({
        hdr: true, label: meta[g][0],
        hdrStyle: 'display:flex; align-items:center; gap:7px; padding:9px 10px 4px; font-size:10.5px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:var(--c-text-faint)',
        dotStyle: `width:7px; height:7px; border-radius:50%; background:${meta[g][1]}; display:inline-block`,
      })
      groups[g].forEach(x => {
        const o = mapFn(x)
        out.push({
          hdr: false, ...o,
          style: `display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; text-align:left; border:none; background:${o.sel ? 'var(--c-bg-muted)' : 'none'}; border-radius:9px; padding:8px 10px; font-size:13px; cursor:pointer; color:${g === 'no' ? 'var(--c-text-faint)' : 'var(--c-text)'}`,
        })
      })
    }
    return out
  }

  componentDidMount() {
    this._doc = () => { if (this.state.dd) this.setState({ dd: null }) }
    document.addEventListener('click', this._doc)
    this._mq = matchMedia('(max-width:640px)')
    this._mqL = () => this.setState({ isMobile: this._mq!.matches })
    if (this._mq.addEventListener) this._mq.addEventListener('change', this._mqL)
    else (this._mq as MediaQueryList & { addListener(l: () => void): void }).addListener(this._mqL)
    // pin the app to the visual viewport while the on-screen keyboard is open (iOS Safari
    // resizes only the visual viewport, which would leave the composer hidden behind the keyboard)
    if (window.visualViewport) {
      this._vv = () => {
        const vv = window.visualViewport!
        if (!this._root) return
        if (window.innerHeight - vv.height > 60) { this._root.style.height = vv.height + 'px'; window.scrollTo(0, 0) }
        else this._root.style.height = ''
      }
      window.visualViewport.addEventListener('resize', this._vv)
    }
    try { if (localStorage.getItem('dryrun-theme') === 'dark') this.setState({ dark: true }) } catch (e) { }
    this._syncDark(this.state.dark)
    this._syncScroll(this.heroNow())
    this.feelTimer = setInterval(() => {
      if (CONFIG.feelEffect !== 'retype') return
      this.setState(x => {
        const word = 'feel', ph = x.feelPhase ?? 'type', n = x.feelN ?? 0
        if (ph === 'type') return n < word.length ? { feelN: n + 1 } : { feelPhase: 'hold' as const, feelN: n, feelT: 0 }
        if (ph === 'hold') return (x.feelT ?? 0) > 5 ? { feelPhase: 'erase' as const } : { feelT: (x.feelT ?? 0) + 1 }
        return n > 0 ? { feelN: n - 1 } : { feelPhase: 'type' as const, feelN: 0 }
      })
    }, 260)
    if (this.state.pendingShare) {
      // question bubble animates in first, then the simulation starts
      setTimeout(() => {
        if (this.state.cfgs.length === 1) this._replayHistory = [] // run() adds the user message itself
        this.setState({ pendingShare: false })
        this.run()
      }, 900)
      return
    }
    // legacy share links: base64 config in the #s= hash
    try {
      const hm = location.hash.match(/s=([^&]+)/)
      if (hm) {
        const d = JSON.parse(atob(decodeURIComponent(hm[1])))
        const patch: Partial<St> = {}
        if (Array.isArray(d.c) && d.c.length) {
          const cf = (d.c as Cfg[])
            .map(x => ({ hw: canonHw(x.hw), model: canonModel(x.model), quant: canonQuant(x.quant) }))
            .filter(x => { const cm = MODELS.find(m => m.id === x.model); return HW.some(h => h.id === x.hw) && cm && cm.quants[x.quant] })
            .slice(0, 2)
          if (cf.length) patch.cfgs = cf
        }
        if (typeof d.p === 'number' && PRESETS[d.p]) patch.preset = d.p
        if (typeof d.t === 'string' && d.t) patch.custom = d.t.slice(0, 2000)
        this.setState(patch, () => { if (d.r) setTimeout(() => this.run(), 600) })
      }
    } catch (e) { }
  }
  componentDidUpdate(_prevProps: {}, prevState: St) {
    if (prevState.dark !== this.state.dark) this._syncDark(this.state.dark)
    this._syncScroll(this.heroNow())
    // keep scrolling through the final running→done render so the appended meta line stays in view
    // (but not on running→idle, i.e. reset)
    if ((this.state.phase === 'running' || (prevState.phase === 'running' && this.state.phase === 'done')) && !this._scrollQueued) {
      this._scrollQueued = true
      requestAnimationFrame(() => {
        this._scrollQueued = false
        const d = this._sc
        if (!d) return
        const target = d.scrollHeight - d.clientHeight
        if (Math.abs(d.scrollTop - target) >= 1) d.scrollTop = target
      })
    }
  }
  componentWillUnmount() {
    clearInterval(this.timer); clearInterval(this.feelTimer)
    if (this._doc) document.removeEventListener('click', this._doc)
    if (this._mq && this._mqL) {
      if (this._mq.removeEventListener) this._mq.removeEventListener('change', this._mqL)
      else (this._mq as MediaQueryList & { removeListener(l: () => void): void }).removeListener(this._mqL)
    }
    if (this._vv && window.visualViewport) window.visualViewport.removeEventListener('resize', this._vv)
    if (this._ro) this._ro.disconnect()
  }

  feelWordEl(): ComponentChild {
    const v = CONFIG.feelEffect
    if (v === 'retype') {
      const n = this.state.feelN ?? 0
      return <span style="display:inline-block; min-width:2.1em; text-align:left">{'feel'.slice(0, n)}<span style="display:inline-block; width:4px; height:0.85em; background:var(--c-ink); vertical-align:-0.06em; margin-left:3px; animation:blink 1s step-end infinite"></span></span>
    }
    if (v === 'wave') return <span style="display:inline-block">{'feel'.split('').map((ch, i) => <span key={i} style={`display:inline-block; animation:feelBob 1.6s ease-in-out ${i * 0.13}s infinite`}>{ch}</span>)}</span>
    if (v === 'shimmer') return <span style="background:linear-gradient(100deg, var(--c-ink) 35%, #b9b9c0 50%, var(--c-ink) 65%); background-size:220% 100%; -webkit-background-clip:text; background-clip:text; color:transparent; animation:feelShimmer 2.6s linear infinite; display:inline-block">feel</span>
    if (v === 'breathe') return <span style="display:inline-block; animation:feelBreathe 2.8s ease-in-out infinite">feel</span>
    if (v === 'gradient') return <span style="background:linear-gradient(105deg, var(--c-ink) 20%, oklch(0.62 0.17 30) 40%, oklch(0.72 0.15 45) 50%, oklch(0.62 0.17 30) 60%, var(--c-ink) 80%); background-size:300% 100%; -webkit-background-clip:text; background-clip:text; color:transparent; animation:feelGradient 7s ease-in-out infinite; display:inline-block">feel</span>
    if (v === 'sparks') {
      const spark = (x: string, y: string, sz: number, delay: number, dur: number) => (
        <svg key={`${x},${y}`} viewBox="0 0 12 12" width={sz} height={sz} style={`position:absolute; left:${x}; top:${y}; animation:feelSpark ${dur}s ease-in-out ${delay}s infinite; opacity:0`} fill="oklch(0.62 0.17 30)">
          <path d="M6 0 L7.4 4.6 L12 6 L7.4 7.4 L6 12 L4.6 7.4 L0 6 L4.6 4.6 Z" />
        </svg>
      )
      return <span style="position:relative; display:inline-block">feel{spark('-14px', '-8px', 11, 0, 2.4)}{spark('96%', '-12px', 14, 0.9, 3.1)}{spark('102%', '60%', 9, 1.7, 2.7)}{spark('-8px', '70%', 8, 2.3, 3.4)}</span>
    }
    return <span>feel</span>
  }

  run() {
    const replayH = this._replayHistory
    this._replayHistory = null
    const s = this.state, ctx = this.promptTokens()
    const lanes: RunLane[] = s.cfgs.map(cfg => {
      const { hw, m, q } = this.resolve(cfg)
      const c = calc(hw, m, q, ctx)
      return { hw, m, q, c, norun: c.fit === 'no', acc: 0, i: 0, done: c.fit === 'no', streamStarted: false, liveTok: c.base, finishT: 0 }
    })
    if (lanes.every(l => l.c.fit === 'no')) return
    const pIdx = s.custom !== null ? 0 : s.preset
    const words = RESP[pIdx].split(' ')
    const text = s.custom !== null ? s.custom : PRESETS[s.preset].text
    this.runCfg = { lanes, words, tokIn: ctx, text }
    this.t0 = performance.now(); this._last = this.t0; this._winner = null
    const st: Partial<St> = {
      phase: 'running',
      cfgOpen: false,
      lanes: lanes.map((l): LaneSt => ({ phase: l.norun ? 'norun' : 'prefill', prefillT: 0, text: '', liveTok: 0, finishT: 0, winner: false })),
    }
    if (!this.isCompare()) Object.assign(st, { history: [...(replayH ?? s.history), { role: 'user' as const, text }], streamText: '', prefillT: 0, liveTok: 0 })
    else st.racePrompt = text
    this.setState(st)
    clearInterval(this.timer)
    this.timer = setInterval(() => this.tick(), 50)
  }

  tick() {
    const now = performance.now(), el = (now - this.t0) / 1000, dt = (now - this._last) / 1000
    this._last = now
    const { lanes, words } = this.runCfg!
    let allDone = true
    const stLanes = lanes.map((l, idx): LaneSt => {
      const prev = this.state.lanes[idx] ?? EMPTY_LANE
      if (l.norun) return prev
      if (l.done) return prev
      if (!l.streamStarted) {
        if (el >= l.c.ttft) { l.streamStarted = true }
        else { allDone = false; return { ...prev, phase: 'prefill', prefillT: el } }
      }
      const jit = 0.72 + Math.random() * 0.56
      l.acc += l.c.base * 0.72 * dt * jit
      const n = Math.floor(l.acc)
      if (n > 0) { l.acc -= n; l.i = Math.min(words.length, l.i + n); l.liveTok = l.c.base * jit }
      if (l.i >= words.length) {
        l.done = true; l.finishT = el
        const winner = !this._winner; if (winner) this._winner = l
        return { phase: 'done', text: words.join(' '), liveTok: 0, finishT: el, winner, prefillT: 0 }
      }
      allDone = false
      return { phase: 'stream', text: words.slice(0, l.i).join(' '), liveTok: l.liveTok, prefillT: 0, finishT: 0, winner: false }
    })
    const st: Partial<St> = { lanes: stLanes }
    if (!this.isCompare()) {
      const sl = stLanes[0]
      st.prefillT = sl.phase === 'prefill' ? sl.prefillT : 0
      st.streamText = sl.phase === 'stream' ? sl.text : ''
      st.liveTok = sl.liveTok || 0
    }
    if (allDone) {
      clearInterval(this.timer)
      st.phase = 'done'
      if (!this.isCompare()) {
        const l = lanes[0]
        const meta = `${l.hw.name} · ${l.m.name} · ${l.q.label} · ${fmt(l.c.base)} tok/s · TTFT ${l.c.ttft < 10 ? l.c.ttft.toFixed(1) : Math.round(l.c.ttft)}s`
        st.history = [...this.state.history, { role: 'assistant' as const, text: words.join(' '), meta }]
        st.streamText = ''
      }
    }
    this.setState(st)
  }

  stop() {
    clearInterval(this.timer)
    if (this.isCompare()) {
      this.setState(s => ({ phase: 'done' as const, lanes: s.lanes.map(l => l.phase === 'stream' || l.phase === 'prefill' ? { ...l, phase: 'done' as const } : l) }))
    } else {
      const s = this.state
      if (s.streamText) {
        const l = this.runCfg!.lanes[0]
        const meta = `${l.hw.name} · ${l.m.name} · ${l.q.label} · ${fmt(l.c.base)} tok/s · stopped`
        this.setState(x => ({ phase: 'done' as const, history: [...x.history, { role: 'assistant' as const, text: x.streamText, meta }], streamText: '' }))
      } else this.setState({ phase: 'idle' })
    }
  }

  // set by replay() so run() applies the trimmed history in the same state update — a separate
  // setState would leave history momentarily empty and flash the hero screen
  _replayHistory: Msg[] | null = null
  replay() {
    if (this.state.phase === 'running' || !this.runCfg) return
    if (!this.isCompare()) {
      const h = [...this.state.history]
      if (h.length && h[h.length - 1].role === 'user') h.pop()
      else if (h.length >= 2) { h.pop(); h.pop() }
      this._replayHistory = h
    }
    this.run()
  }

  share() {
    const s = this.state
    const q = new URLSearchParams()
    q.set('hw', s.cfgs.map(c => c.hw).join(','))
    q.set('model', s.cfgs.map(c => c.model).join(','))
    q.set('quant', s.cfgs.map(c => c.quant).join(','))
    if (s.custom !== null) q.set('prompt', s.custom.slice(0, 2000))
    else q.set('preset', String(s.preset))
    q.set('run', '1')
    const url = 'https://llmspeed.dev/?' + q.toString().replace(/%2C/g, ',')
    ;(navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).catch(() => { })
    this.setState({ shared: true })
    clearTimeout(this._shT)
    this._shT = setTimeout(() => this.setState({ shared: false }), 1600)
  }

  cfgRow(i: number) {
    const s = this.state, cfg = s.cfgs[i], { hw, m, q } = this.resolve(cfg), ctx = this.promptTokens()
    const c = calc(hw, m, q, ctx)
    const compare = this.isCompare()
    const setCfg = (patch: Partial<Cfg>) => this.setState(x => ({
      cfgs: x.cfgs.map((cc, j) => {
        if (j !== i) return cc
        const next = { ...cc, ...patch }
        // a newly picked model may lack the selected quant — fall back to its smallest
        const nm = MODELS.find(mm => mm.id === next.model)!
        if (!nm.quants[next.quant]) next.quant = quantsFor(nm)[0].id
        return next
      }), dd: null,
    }))
    const dd = (k: string) => k + i
    const fitColors: Record<Fit, string> = { fits: 'oklch(0.55 0.15 155)', partial: 'oklch(0.68 0.13 85)', no: 'oklch(0.55 0.19 25)' }
    const fitLabels: Record<Fit, string> = { fits: `Fits in ${c.usable.toFixed(0)} GB`, partial: 'Partial offload', no: "Won't run" }
    const fc = fitColors[c.fit]
    void fc
    const sortBtn = (act: boolean) => `border-radius:99px; padding:3px 11px; font-size:11.5px; cursor:pointer; ${act ? 'background:var(--c-ink); border:1px solid var(--c-ink); color:var(--c-bg)' : 'background:none; border:1px solid var(--c-border); color:var(--c-text-muted)'}`
    return {
      showPreset: i === 0, showBadge: compare, rowBadge: i ? 'B' : 'A',
      rowBadgeStyle: `width:20px; height:20px; border-radius:6px; background:${i ? 'var(--c-badge-b-bg)' : 'var(--c-bg-muted)'}; color:${i ? 'var(--c-badge-b)' : 'var(--c-text-sec)'}; font-size:11px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0`,
      hwName: hw.name, modelName: m.name, quantName: q.label,
      hwDdOpen: s.dd === dd('hw'), modelDdOpen: s.dd === dd('model'), quantDdOpen: s.dd === dd('quant'),
      toggleHwDd: (e: Event) => { e.stopPropagation(); this.setState(x => ({ dd: x.dd === dd('hw') ? null : dd('hw') })) },
      toggleModelDd: (e: Event) => { e.stopPropagation(); this.setState(x => ({ dd: x.dd === dd('model') ? null : dd('model') })) },
      toggleQuantDd: (e: Event) => { e.stopPropagation(); this.setState(x => ({ dd: x.dd === dd('quant') ? null : dd('quant'), tip: null })) },
      hwSortBtns: ([['pop', 'Popular'], ['ram', 'RAM']] as ['pop' | 'ram', string][]).map(([id, label]) => ({
        label,
        pick: (e: Event) => { e.stopPropagation(); this.setState({ hwSort: id }) },
        style: sortBtn(s.hwSort === id),
      })),
      modelSortBtns: ([['pop', 'Popular'], ['size', 'Size']] as ['pop' | 'size', string][]).map(([id, label]) => ({
        label,
        pick: (e: Event) => { e.stopPropagation(); this.setState({ modelSort: id }) },
        style: sortBtn(s.modelSort === id),
      })),
      hwOpts: this.groupOpts(
        [...HW].sort((a, b) => s.hwSort === 'ram' ? b.vram_gb - a.vram_gb || a.popularity_rank - b.popularity_rank : a.popularity_rank - b.popularity_rank),
        h => calc(h, m, q, ctx).fit,
        h => ({ name: h.name, meta: `${h.vram_gb} GB${h.status === 'announced' ? ' · announced' : ''}`, sel: h.id === cfg.hw, pick: () => setCfg({ hw: h.id }) })),
      modelOpts: this.groupOpts(
        [...MODELS].sort((a, b) => s.modelSort === 'size' ? a.total_params_b - b.total_params_b || a.popularity_rank - b.popularity_rank : a.popularity_rank - b.popularity_rank),
        mm => calc(hw, mm, quantOf(mm.quants[q.id] ? q.id : quantsFor(mm)[0].id), ctx).fit,
        mm => ({ name: mm.name, meta: `${mm.total_params_b} B`, sel: mm.id === cfg.model, pick: () => setCfg({ model: mm.id }) })),
      quantOpts: quantsFor(m).map(qq => ({
        name: qq.label, meta: qq.id === 'q4_k_m' ? 'small · fast' : qq.id === 'q8_0' ? 'balanced' : qq.id === 'fp16' ? 'full quality' : `${m.quants[qq.id].file_gb.toFixed(1)} GB`,
        pick: () => setCfg({ quant: qq.id }),
        style: `display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; text-align:left; border:none; background:${qq.id === cfg.quant ? 'var(--c-bg-muted)' : 'none'}; border-radius:9px; padding:8px 10px; font-size:13px; cursor:pointer; color:var(--c-text)`,
      })),
      showQuantTip: i === 0,
      tipQuant: s.tip === 'quant' && s.dd !== dd('quant'),
      tipQuantOn: () => this.setState({ tip: 'quant' }),
      quantHelp: `Quantization shrinks the model to fewer bits per weight. Smaller = less memory, faster, slightly lower quality. ${q.label} → ${c.w.toFixed(1)} GB.`,
      fitLabel: fitLabels[c.fit],
      fitIsFits: c.fit === 'fits', fitIsPartial: c.fit === 'partial', fitIsNo: c.fit === 'no',
      showFitBadge: CONFIG.fitBadgeStyle !== 'hidden',
      showMeter: CONFIG.fitBadgeStyle === 'meter',
      meterFillStyle: `display:block; height:100%; border-radius:3px; width:${Math.min(100, c.total / c.usable * 100).toFixed(0)}%; background:${c.fit === 'no' ? 'var(--c-ink)' : 'var(--c-text-muted)'}`,
      fitChipStyle: (() => {
        const v = CONFIG.fitBadgeStyle
        const base = 'position:relative; display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:500; white-space:nowrap; flex-shrink:0; cursor:help; margin-left:auto'
        if (v === 'minimal') return `${base}; color:${c.fit === 'no' ? 'var(--c-ink)' : 'var(--c-text-muted)'}; padding:7px 2px`
        if (v === 'solid') return `${base}; color:${c.fit === 'no' ? 'var(--c-bg)' : 'var(--c-text-strong)'}; background:${c.fit === 'no' ? 'var(--c-ink)' : 'var(--c-bg-muted)'}; border:none; border-radius:99px; padding:8px 14px`
        if (v === 'meter') return `${base}; color:var(--c-text-sec); background:none; border:1px solid var(--c-border); border-radius:99px; padding:7px 13px`
        return `${base}; color:${c.fit === 'no' ? 'var(--c-ink)' : 'var(--c-text-sec)'}; background:${c.fit === 'no' ? 'var(--c-bg-muted)' : 'var(--c-bg-subtle)'}; border:1px solid ${c.fit === 'no' ? 'var(--c-border-strong)' : 'var(--c-border)'}; border-radius:99px; padding:7px 13px`
      })(),
      tipFit: s.tip === 'fit' + i,
      tipFitOn: () => this.setState({ tip: 'fit' + i }),
      fitHelp: c.fit === 'fits' ? `Model + context (${c.total.toFixed(1)} GB) fits in the ${c.usable.toFixed(1)} GB of usable memory — full speed.`
        : c.fit === 'partial' ? `Needs ${c.total.toFixed(1)} GB, only ${c.usable.toFixed(1)} GB fits on the GPU. ~${Math.round((1 - c.gpuShare) * 100)}% of the weights are served from system RAM instead — that share streams at RAM speed and caps decode.`
        : `Needs ${c.total.toFixed(1)} GB; only ${c.usable.toFixed(1)} GB available. Doesn't fit, can't run.`,
      showRemove: compare && i === 1,
      showAddRace: !compare && CONFIG.showCompare && CONFIG.comparePlacement === 'config-row',
      _c: c, _hw: hw, _m: m, _q: q,
    }
  }

  renderVals() {
    const s = this.state, ctx = this.promptTokens()
    const compare = this.isCompare()
    const rows = s.cfgs.map((_, i) => this.cfgRow(i))
    const c0 = rows[0]._c
    const busy = s.phase === 'running'
    const accent = 'oklch(0.62 0.17 30)'
    const confMap: Record<string, [string, string]> = { measured: ['Measured', 'oklch(0.55 0.15 155)'], derived: ['Derived', 'oklch(0.68 0.13 85)'], projected: ['Projected', 'oklch(0.66 0.16 55)'] }
    const statRows = rows.map((r, i) => {
      const c = r._c, conf = c.conf ? confMap[c.conf] : ['—', 'var(--c-border-strong)']
      return {
        showBadge: compare, badge: i ? 'B' : 'A',
        badgeStyle: `width:17px; height:17px; border-radius:5px; background:${i ? 'var(--c-badge-b-bg)' : 'var(--c-bg-muted)'}; color:${i ? 'var(--c-badge-b)' : 'var(--c-text-sec)'}; font-size:10px; font-weight:700; display:inline-flex; align-items:center; justify-content:center`,
        range: c.fit === 'no' ? '—' : `${fmt(c.lo)}–${fmt(c.hi)}`,
        ttft: c.fit === 'no' ? '—' : (c.ttft < 10 ? c.ttft.toFixed(2).replace(/0$/, '') : String(Math.round(c.ttft))) + ' s',
        confLabel: conf[0], confDotStyle: `width:8px; height:8px; border-radius:50%; background:${conf[1]}; display:inline-block`,
        showTips: i === 0 && !compare,
      }
    })
    const mkRows = (r: ReturnType<App['cfgRow']>) => {
      const c = r._c, m = r._m, hw = r._hw, q = r._q
      return c.fit === 'no' ? [
        { n: '1', f: `Weights: ${m.total_params_b} B params @ ${q.label} (file size)`, v: `${c.w.toFixed(1)} GB` },
        { n: '2', f: `KV cache @ ${ctx.toLocaleString()} ctx tokens (${m.kv_gb_per_8k} GB per 8k)`, v: `${c.kv.toFixed(1)} GB` },
        { n: '3', f: `Total vs usable memory (${hw.vendor === 'apple' ? '75% of unified' : '93% of VRAM'})`, v: `${c.total.toFixed(1)} / ${c.usable.toFixed(1)} GB` },
        { n: '4', f: 'Result', v: "won't run" },
      ] : [
        { n: '1', f: `Weights: ${m.total_params_b} B params @ ${q.label} (file size)`, v: `${c.w.toFixed(1)} GB` },
        { n: '2', f: `KV cache @ ${ctx.toLocaleString()} ctx tokens (${m.kv_gb_per_8k} GB per 8k)`, v: `${c.kv.toFixed(1)} GB` },
        { n: '3', f: `Fit: ${c.total.toFixed(1)} GB needed vs ${c.usable.toFixed(1)} GB usable`, v: c.fit === 'fits' ? 'fits' : 'partial offload' },
        { n: '4', f: c.fit === 'partial'
          ? `Decode: hybrid offload — ${Math.round(c.gpuShare * 100)}% of active weights read at GPU speed (${hw.bandwidth_gbs} GB/s × ${c.eff}), ${Math.round((1 - c.gpuShare) * 100)}% at system-RAM speed (~${OFFLOAD.ram_bw_gbs} GB/s)`
          : c.fromCombo
          ? 'Decode: benchmark range for this combo × context derating'
          : `Decode ≈ bandwidth × efficiency ÷ active weights: ${hw.bandwidth_gbs} GB/s × ${c.eff} ÷ ${c.aw.toFixed(1)} GB`, v: `${fmt(c.base)} tok/s` },
        { n: '5', f: c.fit === 'partial' ? 'Spread: calibrated from measured offload runs (RAM speeds vary)' : c.fromCombo ? 'Spread: holdout-validated interval' : 'Spread ±15% (engine, thermals, runtime)', v: `${fmt(c.lo)}–${fmt(c.hi)} tok/s` },
        { n: '6', f: `Prefill ≈ ${Math.round(c.pre).toLocaleString()} tok/s → ${ctx.toLocaleString()} ÷ that + overhead`, v: `TTFT ${c.ttft < 10 ? c.ttft.toFixed(1) : Math.round(c.ttft)} s` },
      ]
    }
    const breakdownSecs = rows.map((r, i) => ({ showLabel: compare, label: `${i ? 'B' : 'A'} — ${r._hw.name} · ${r._m.name} · ${r._q.label}`, rows: mkRows(r) }))
    let suggShow = false, suggLabel = '', suggQ: string | null = null
    if (!compare && c0.fit !== 'fits') {
      const { hw, m, q } = this.resolve(s.cfgs[0])
      const curGb = m.quants[q.id] ? m.quants[q.id].file_gb : Infinity
      for (const alt of quantsFor(m)) {
        if (m.quants[alt.id].file_gb >= curGb) continue
        const ac = calc(hw, m, alt, ctx)
        if (ac.fit === 'fits') { suggShow = true; suggQ = alt.id; suggLabel = `Switch to ${alt.label} — fits, ~${fmt(ac.lo)}–${fmt(ac.hi)} tok/s`; break }
      }
    }
    const raceActive = compare && (((busy || s.phase === 'done') && s.lanes.length > 1) || s.pendingShare)
    const heroMode = !raceActive && s.history.length === 0 && !busy && !s.pendingShare
    const chatMode = !compare && !heroMode
    // mobile config collapse only applies once in a conversation; the hero keeps inline chips
    const collapse = s.isMobile && !heroMode
    const wait = this.runCfg && this.runCfg.lanes[0] ? this.runCfg.lanes[0].c.ttft : 1
    const prefillFrac = Math.min(1, s.prefillT / Math.max(0.01, wait))
    const pStatus = (f: number) => f < 0.22 ? 'Loading weights' : f < 0.45 ? 'Allocating KV cache' : `Prefilling ${(this.runCfg ? this.runCfg.tokIn : ctx).toLocaleString()} tokens`
    const raceLanes = (this.runCfg && raceActive ? this.runCfg.lanes : []).map((l, i) => {
      const sl = s.lanes[i] || EMPTY_LANE
      const won = sl.winner
      return {
        badge: i ? 'B' : 'A',
        badgeStyle: `width:20px; height:20px; border-radius:6px; background:${i ? 'var(--c-badge-b-bg)' : 'var(--c-bg-muted)'}; color:${i ? 'var(--c-badge-b)' : 'var(--c-text-sec)'}; font-size:11px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0`,
        title: `${l.hw.name} · ${l.m.name} · ${l.q.label}`,
        cardStyle: `border:1px solid ${won ? 'oklch(0.62 0.17 30 / .45)' : 'var(--c-border)'}; border-radius:16px; background:var(--c-bg); overflow:hidden; ${won ? 'box-shadow:0 4px 20px oklch(0.62 0.17 30 / .12)' : ''}`,
        norun: sl.phase === 'norun',
        norunText: `Won't run: needs ${l.c.total.toFixed(1)} GB, has ${l.c.usable.toFixed(1)} GB usable. Sits this race out.`,
        prefill: sl.phase === 'prefill',
        spinner: SPIN[Math.floor((sl.prefillT || 0) * 10) % 10],
        prefillStatus: pStatus(Math.min(1, (sl.prefillT || 0) / Math.max(0.01, l.c.ttft))),
        clock: `${(sl.prefillT || 0).toFixed(1)}s`,
        showText: sl.phase === 'stream' || sl.phase === 'done',
        text: sl.text || '',
        cursor: sl.phase === 'stream',
        status: sl.phase === 'norun' ? "won't run"
          : sl.phase === 'prefill' ? 'prefill…'
          : sl.phase === 'stream' ? `${fmt(sl.liveTok || 0)} tok/s`
          : `${won ? 'finished first · ' : ''}${(sl.finishT || 0).toFixed(1)}s`,
        statusColor: sl.phase === 'done' ? (won ? 'oklch(0.52 0.17 30)' : 'var(--c-text-muted)') : sl.phase === 'norun' ? 'oklch(0.55 0.19 25)' : 'oklch(0.62 0.17 30)',
      }
    })
    const runnable = rows.some(r => r._c.fit !== 'no')
    return {
      feelWord: this.feelWordEl(),
      showReset: !heroMode,
      resetIconHome: CONFIG.resetIcon === 'home',
      resetIconPlus: CONFIG.resetIcon === 'plus',
      resetIconEdit: CONFIG.resetIcon === 'new-chat',
      resetIconRefresh: CONFIG.resetIcon === 'refresh',
      resetAll: () => { clearInterval(this.timer); this.runCfg = null; if (this._sc) this._sc.scrollTop = 0; this.setState({ phase: 'idle', history: [], lanes: [], racePrompt: '', streamText: '', prefillT: 0, liveTok: 0, custom: null, breakdownOpen: false, cfgOpen: false }) },
      darkAttr: s.dark ? '1' : '0', isDark: s.dark, isLight: !s.dark,
      toggleDark: () => this.setState(x => {
        const d = !x.dark
        try { localStorage.setItem('dryrun-theme', d ? 'dark' : 'light') } catch (e) { }
        return { dark: d }
      }),
      maxW: compare ? '980px' : '780px',
      // hero: the document scrolls (native iOS pull-to-refresh); root/scroller are plain flow.
      // conversation: fixed-height app shell with an inner scroller (browser chrome stays put).
      rootStyle: heroMode
        ? 'display:flex; flex-direction:column; position:relative; background:var(--c-bg); color:var(--c-ink); font-family:\'Instrument Sans\',sans-serif'
        : 'display:flex; flex-direction:column; overflow:hidden; position:relative; background:var(--c-bg); color:var(--c-ink); font-family:\'Instrument Sans\',sans-serif',
      scrollerStyle: heroMode ? 'flex:1; display:flex; flex-direction:column' : 'flex:1; min-height:0; overflow-y:scroll; overflow-x:hidden',
      // mobile hero is slightly taller than the viewport so it scrolls a touch and sits ~20px lower
      wrapperStyle: heroMode
        ? (s.isMobile
          ? 'min-height:calc(100vh + 40px); min-height:calc(100dvh + 40px); display:flex; flex-direction:column'
          : 'min-height:100vh; min-height:100dvh; display:flex; flex-direction:column')
        : 'min-height:100%; display:flex; flex-direction:column',
      heroMode, chatMode, raceMode: raceActive,
      collapse, cfgOpen: s.cfgOpen,
      toggleCfgPanel: () => this.setState(x => ({ cfgOpen: !x.cfgOpen })),
      heroWrapStyle: 'margin-top:auto; text-align:center; padding-bottom:34px',
      // the decorative bottom spacer overflows short phone viewports and breaks hero centering
      showHeroSpacer: heroMode && !s.isMobile,
      composerWrapStyle: heroMode
        ? 'margin-bottom:auto; padding:8px 0 12px; position:relative'
        : 'position:absolute; bottom:0; left:0; right:0; z-index:10; padding-top:14px',
      composerRef: heroMode ? undefined : this._compRef,
      composerInnerClass: heroMode ? undefined : 'page-col',
      composerInnerStyle: heroMode ? '' : `max-width:${compare ? '980px' : '780px'}; margin:0 auto; padding-bottom:12px; position:relative`,
      scrollPadBottom: s.composerH + 16,
      // bottom sheet: a direct child of the fixed-height root (same level as the conversation
      // scroller, which touch-scrolls reliably on iOS) with pixel-based sizing
      cfgPanelStyle: `position:absolute; left:16px; right:16px; bottom:${s.composerH + 8}px; max-height:calc(100% - ${s.composerH + 40}px); overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; background:var(--c-bg); border:1px solid var(--c-border); border-radius:16px; padding:4px 14px 14px; box-shadow:0 10px 30px rgba(0,0,0,.12); z-index:12`,
      cfgToggleStyle: `display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:99px; border:1px solid ${s.cfgOpen ? 'var(--c-border-strong)' : 'var(--c-border)'}; background:${s.cfgOpen ? 'var(--c-bg-muted)' : 'none'}; color:${s.cfgOpen ? 'var(--c-ink)' : 'var(--c-text-sec)'}; cursor:pointer; padding:0; flex-shrink:0; transition:transform .2s ease; transform:rotate(${s.cfgOpen ? '45deg' : '0deg'})`,
      breakdownWrapStyle: `border:1px solid var(--c-border-faint); background:var(--c-bg-subtle); border-radius:14px; padding:16px 18px; display:flex; flex-direction:column; gap:14px; ${heroMode ? 'position:absolute; top:calc(100% - 2px); left:0; right:0; z-index:25; box-shadow:0 10px 30px rgba(0,0,0,.08)' : 'margin-top:12px'}`,
      // dropdowns/tooltips open downward inside the scrollable "+" panel: upward overflow would be
      // clipped by the scroll container, downward overflow just extends its scroll area
      menuAnchor: collapse ? 'top:calc(100% + 6px)' : 'bottom:38px',
      tipAnchorQuant: collapse ? 'top:calc(100% + 6px)' : 'bottom:26px',
      tipAnchorStat: collapse ? 'top:calc(100% + 6px)' : 'bottom:24px',
      cfgRows: rows, statRows, breakdownSecs,
      showCompareBtn: !compare && CONFIG.showCompare && CONFIG.comparePlacement === 'stats',
      showCompareComposer: !compare && CONFIG.showCompare && CONFIG.comparePlacement === 'composer',
      showCompareNav: !compare && CONFIG.showCompare && CONFIG.comparePlacement === 'navbar',
      showShareBtn: CONFIG.showShare,
      showShareNav: !heroMode,
      shareNavStyle: (() => {
        const v = CONFIG.shareStyle
        const base = 'display:inline-flex; align-items:center; justify-content:center; gap:6px; border-radius:99px; padding:6px 14px; font-size:13px; font-weight:600; cursor:pointer; min-width:92px'
        if (s.shared) return `${base}; background:oklch(0.62 0.17 30 / .08); border:1px solid oklch(0.62 0.17 30 / .5); color:oklch(0.52 0.17 30)`
        if (v === 'coral-solid') return `${base}; background:oklch(0.62 0.17 30); border:1px solid oklch(0.62 0.17 30); color:#ffffff`
        if (v === 'coral-outline') return `${base}; background:oklch(0.62 0.17 30 / .06); border:1px solid oklch(0.62 0.17 30 / .55); color:oklch(0.52 0.17 30)`
        if (v === 'ink-solid') return `${base}; background:var(--c-ink); border:1px solid var(--c-ink); color:var(--c-bg)`
        return `${base}; background:none; border:1px solid var(--c-border); color:var(--c-text-sec); font-weight:500`
      })(),
      addCompare: () => this.setState(x => ({ cfgs: [x.cfgs[0], { ...x.cfgs[0], hw: x.cfgs[0].hw === 'm4-pro-24gb' ? 'rtx-4090' : 'm4-pro-24gb' }], lanes: [], racePrompt: '', phase: 'idle' as const })),
      removeCompare: () => this.setState(x => ({ cfgs: [x.cfgs[0]], lanes: [], phase: 'idle' as const })),
      share: () => this.share(),
      shareLabel: s.shared ? 'Copied' : 'Share',
      shareBtnStyle: `background:${s.shared ? 'oklch(0.62 0.17 30 / .08)' : 'none'}; border:1px solid ${s.shared ? 'oklch(0.62 0.17 30 / .5)' : 'var(--c-border)'}; color:${s.shared ? 'oklch(0.52 0.17 30)' : 'var(--c-text-sec)'}; border-radius:99px; padding:6px 13px; font-size:13px; font-weight:500; cursor:pointer`,
      wontRun: !compare && c0.fit === 'no' && !busy && !(collapse && s.cfgOpen),
      wontRunDetail: (() => { const r = rows[0]; return `${r._m.name} at ${r._q.label} needs ${c0.total.toFixed(1)} GB — the ${r._hw.name} has ${c0.usable.toFixed(1)} GB usable. ${suggShow ? '' : 'No quantization of this model fits; pick a smaller model or more memory.'}` })(),
      suggShow, suggLabel,
      applySugg: () => suggQ && this.setState(x => ({ cfgs: x.cfgs.map((cc, j) => j === 0 ? { ...cc, quant: suggQ! } : cc) })),
      tokHelp: 'How many words per second the model streams. ~15 tok/s reads like fast typing; 50+ feels instant.',
      ttftHelp: 'Time to first token: how long the model reads your prompt before it starts answering. Grows with prompt length.',
      confHelp: 'How solid this prediction is. Measured = benchmarked on this exact setup. Derived = interpolated from similar setups. Projected = calculated from hardware specs alone.',
      tipTok: s.tip === 'tok', tipTtft: s.tip === 'ttft', tipConf: s.tip === 'conf',
      tipTokOn: () => this.setState({ tip: 'tok' }),
      tipTtftOn: () => this.setState({ tip: 'ttft' }),
      tipConfOn: () => this.setState({ tip: 'conf' }),
      tipOff: () => this.setState({ tip: null }),
      showReplay: s.phase === 'done',
      replay: () => this.replay(),
      toggleBreakdown: () => this.setState(x => ({ breakdownOpen: !x.breakdownOpen })),
      breakdownToggleLabel: s.breakdownOpen ? 'How we calculated this ▴' : 'How we calculated this ▾',
      breakdownOpen: s.breakdownOpen,
      scrollRef: (el: HTMLElement | null) => { this._sc = el },
      messages: s.history.map(mm => ({
        text: mm.text, meta: mm.meta || false as string | false,
        wrapStyle: mm.role === 'user' ? 'align-self:flex-end; max-width:540px; animation:bubbleIn .6s cubic-bezier(.22,.61,.36,1) both' : 'align-self:flex-start; max-width:680px',
        bubbleStyle: mm.role === 'user'
          ? 'background:var(--c-bg-muted); border-radius:16px 16px 4px 16px; padding:12px 16px; font-size:14.5px; line-height:23px; color:var(--c-text); white-space:pre-wrap'
          : 'font-size:15px; line-height:26px; color:var(--c-text); white-space:pre-wrap',
      })),
      isPrefill: !compare && busy && s.lanes[0] && s.lanes[0].phase === 'prefill',
      spinner: SPIN[Math.floor(s.prefillT * 10) % 10],
      prefillStatus: pStatus(prefillFrac),
      prefillClock: `${s.prefillT.toFixed(1)}s`,
      isStream: !compare && busy && s.lanes[0] && s.lanes[0].phase === 'stream',
      liveTokLabel: `${fmt(s.liveTok)} tok/s`,
      streamText: s.streamText,
      racePrompt: s.racePrompt,
      raceLanes,
      presetName: s.custom !== null ? 'Custom prompt' : PRESETS[s.preset].label,
      presetDdOpen: s.dd === 'preset',
      togglePresetDd: (e: Event) => { e.stopPropagation(); this.setState(x => ({ dd: x.dd === 'preset' ? null : 'preset' })) },
      presetOpts: PRESETS.map((p, i) => ({
        name: p.label, meta: `~${p.tok.toLocaleString()} tok`,
        pick: () => this.setState({ preset: i, custom: null, dd: null }),
        style: `display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; text-align:left; border:none; background:${s.custom === null && i === s.preset ? 'var(--c-bg-muted)' : 'none'}; border-radius:9px; padding:8px 10px; font-size:13px; cursor:pointer; color:var(--c-text)`,
      })),
      customChipStyle: `font-family:'IBM Plex Mono',monospace; font-size:11.5px; color:${s.custom !== null ? 'var(--c-ink)' : 'var(--c-text-faint)'}; margin-left:auto; flex-shrink:0`,
      promptTokLabel: `${s.custom !== null ? 'custom · ' : ''}~${ctx.toLocaleString()} tok`,
      taRows: collapse ? 1 : 2,
      taPlaceholder: collapse ? `Simulating "${PRESETS[s.preset].label}"…` : `Simulating "${PRESETS[s.preset].label}" — or type your own prompt…`,
      taStyle: `display:block; width:100%; border:none; resize:none; padding:${collapse ? '12px 16px 4px' : '16px 18px 8px'}; line-height:24px; background:transparent; font-size:15px; color:var(--c-ink)`,
      promptText: s.custom !== null ? s.custom : '',
      setCustom: (e: Event) => { const t = e.target as HTMLTextAreaElement; this.setState({ custom: t.value === '' ? null : t.value }) },
      runOrStop: () => busy ? this.stop() : this.run(),
      runLabel: busy ? '■ Stop' : (!runnable ? "Won't run" : compare ? 'Race ▸' : 'Run ▸'),
      runBtnStyle: (() => {
        const rc = CONFIG.runButtonColor
        const bg = rc === 'black' ? 'var(--c-ink)' : rc === 'coral' ? accent : 'var(--c-text-strong)'
        return `padding:9px 20px; border-radius:99px; font-size:14px; font-weight:600; margin-left:10px; cursor:${!runnable && !busy ? 'default' : 'pointer'}; ${busy ? 'background:var(--c-bg-muted); border:1px solid var(--c-border); color:var(--c-text-strong)' : !runnable ? 'background:none; border:1px dashed var(--c-border-strong); color:var(--c-text-faint)' : `background:${bg}; border:1px solid ${bg}; color:var(--c-bg)`}`
      })(),
    }
  }

  render() {
    const v = this.renderVals()
    return (
      <div ref={this._rootRef} data-dark={v.darkAttr} class="app-root" style={v.rootStyle}>
        {!v.heroMode && this.renderNav(v)}
        <div ref={v.scrollRef} style={v.scrollerStyle}>
        <div style={v.wrapperStyle}>
        {v.heroMode && this.renderNav(v)}
        <div class="page-col" style={`flex:1; display:flex; flex-direction:column; width:100%; max-width:${v.maxW}; margin:0 auto`}>
          {v.heroMode && (
            <div style={v.heroWrapStyle}>
              <h1 class="hero-title" style="font-weight:700; letter-spacing:-0.03em; margin:0 0 12px; color:var(--c-ink); transition:color .8s ease">How fast will your local model {v.feelWord}?</h1>
              <p class="hero-sub" style="color:var(--c-text-muted); margin:0; line-height:1.55">Pick hardware and a model.<br class="hero-sub-br" /> Feel the real speed before you buy.</p>
            </div>
          )}
          {v.chatMode && (
            <div style={`flex:1; padding:28px 4px ${v.scrollPadBottom}px; display:flex; flex-direction:column; gap:22px`}>
              {v.messages.map((m, i) => (
                <div key={i} style={m.wrapStyle}>
                  <div style={m.bubbleStyle}>{m.text}</div>
                  {m.meta && <div style="font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--c-text-faint); margin-top:7px">{m.meta}</div>}
                </div>
              ))}
              {v.isPrefill && (
                <div style="display:flex; align-items:center; gap:10px; font-family:'IBM Plex Mono',monospace; font-size:13px; color:oklch(0.62 0.17 30)">
                  <span>{v.spinner}</span>
                  <span>{v.prefillStatus}</span>
                  <span style="color:var(--c-text-faint)">{v.prefillClock}</span>
                </div>
              )}
              {v.isStream && (
                <div style="max-width:680px">
                  <div style="display:inline-flex; align-items:center; gap:6px; font-family:'IBM Plex Mono',monospace; font-size:11px; color:oklch(0.62 0.17 30); margin-bottom:8px">
                    <span style="animation:pulse 1.1s ease-in-out infinite">●</span>
                    <span>{v.liveTokLabel}</span>
                  </div>
                  <div style="font-size:15px; line-height:26px; color:var(--c-text); white-space:pre-wrap">{v.streamText}<span style="display:inline-block; width:8px; height:17px; background:oklch(0.62 0.17 30); vertical-align:-2px; margin-left:2px; animation:blink 1s step-end infinite"></span></div>
                </div>
              )}
            </div>
          )}
          {v.raceMode && (
            <div style={`flex:1; padding:28px 4px ${v.scrollPadBottom}px; display:flex; flex-direction:column; gap:18px`}>
              <div style="align-self:flex-end; max-width:540px; background:var(--c-bg-muted); border-radius:16px 16px 4px 16px; padding:12px 16px; font-size:14.5px; line-height:23px; color:var(--c-text); white-space:pre-wrap; animation:bubbleIn .6s cubic-bezier(.22,.61,.36,1) both">{v.racePrompt}</div>
              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:16px; align-items:start">
                {v.raceLanes.map((L, i) => (
                  <div key={i} style={L.cardStyle}>
                    <div style="display:flex; align-items:center; gap:8px; padding:12px 16px; border-bottom:1px solid var(--c-border-faint)">
                      <span style={L.badgeStyle}>{L.badge}</span>
                      <span style="font-size:12.5px; font-weight:600; color:var(--c-text-strong); overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{L.title}</span>
                      <span style={`margin-left:auto; font-family:'IBM Plex Mono',monospace; font-size:11px; color:${L.statusColor}; white-space:nowrap; flex-shrink:0`}>{L.status}</span>
                    </div>
                    <div style="padding:14px 16px; min-height:120px">
                      {L.norun && <div style="font-size:13px; color:var(--c-text-muted); line-height:1.55">{L.norunText}</div>}
                      {L.prefill && (
                        <div style="display:flex; align-items:center; gap:9px; font-family:'IBM Plex Mono',monospace; font-size:12.5px; color:oklch(0.62 0.17 30)">
                          <span>{L.spinner}</span><span>{L.prefillStatus}</span><span style="color:var(--c-text-faint)">{L.clock}</span>
                        </div>
                      )}
                      {L.showText && (
                        <div style="font-size:13.5px; line-height:22px; color:var(--c-text); white-space:pre-wrap">{L.text}{L.cursor && <span style="display:inline-block; width:7px; height:15px; background:oklch(0.62 0.17 30); vertical-align:-2px; margin-left:2px; animation:blink 1s step-end infinite"></span>}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {v.heroMode && this.renderComposer(v)}
          {v.showHeroSpacer && <div style="height:61px; flex-shrink:0"></div>}
        </div>
        </div>
        </div>
        {v.collapse && v.cfgOpen && <div style={v.cfgPanelStyle}>{this.renderConfigBlock(v)}</div>}
        {!v.heroMode && this.renderComposer(v)}
      </div>
    )
  }

  renderNav(v: ReturnType<App['renderVals']>) {
    return (
        <nav style="display:flex; align-items:center; justify-content:space-between; padding:14px 24px; flex-shrink:0">
          {v.showReset ? (
            <button onClick={v.resetAll} title="New simulation" class="hv-ink" style="display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:99px; border:1px solid var(--c-border); background:none; color:var(--c-text-sec); cursor:pointer; padding:0">
              {v.resetIconHome && <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M3 7.5 8 3l5 4.5" /><path d="M4 6.8V13h8V6.8" /><path d="M6.7 13v-3.4h2.6V13" /></svg>}
              {v.resetIconPlus && <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>}
              {v.resetIconEdit && <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M13 8.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4.5" /><path d="M12.3 2.3a1.2 1.2 0 0 1 1.7 1.7L8.5 9.5 6 10l.5-2.5z" /></svg>}
              {v.resetIconRefresh && <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" /><path d="M13.5 2v2.5H11" /></svg>}
            </button>
          ) : <span></span>}
          <div style="display:flex; align-items:center; gap:10px">
            {v.showShareNav && (
              <button onClick={v.share} style={v.shareNavStyle}>
                <svg viewBox="0 0 16 16" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style="flex-shrink:0"><path d="M8 10V2.5" /><path d="M5.2 5 8 2.2 10.8 5" /><path d="M3 8v5h10V8" /></svg>
                {v.shareLabel}
              </button>
            )}
            {v.showCompareNav && (
              <button onClick={v.addCompare} class="hv-ink" style="display:inline-flex; align-items:center; gap:6px; background:none; border:1px solid var(--c-border); color:var(--c-text-sec); border-radius:99px; padding:6px 13px; font-size:13px; font-weight:500; cursor:pointer">⇄ Compare</button>
            )}
            <a href="https://github.com/albinstman/llmspeed" target="_blank" rel="noopener" class="hv-ink" style="display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:500; color:var(--c-text-sec); text-decoration:none; border:1px solid var(--c-border); border-radius:99px; padding:6px 13px">
              <svg viewBox="0 0 16 16" width={15} height={15} fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" /></svg>
              GitHub
            </a>
            <button onClick={v.toggleDark} title={v.isLight ? 'Switch to dark mode' : 'Switch to light mode'} aria-label={v.isLight ? 'Switch to dark mode' : 'Switch to light mode'} class="hv-ink" style="display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:99px; border:1px solid var(--c-border); background:none; color:var(--c-text-sec); cursor:pointer; padding:0">
              {v.isLight
                ? <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"><path d="M13.6 9.4A5.6 5.6 0 1 1 6.6 2.4a4.6 4.6 0 0 0 7 7z" strokeLinejoin="round" /></svg>
                : <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"><circle cx={8} cy={8} r={3.2} /><path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3 3l1.3 1.3M11.7 11.7L13 13M13 3l-1.3 1.3M4.3 11.7L3 13" /></svg>}
            </button>
          </div>
        </nav>
    )
  }

  renderComposer(v: ReturnType<App['renderVals']>) {
    return (
          <div ref={v.composerRef} style={v.composerWrapStyle}>
            {!v.heroMode && <div aria-hidden style="position:absolute; inset:0; background:var(--c-bg); -webkit-mask-image:linear-gradient(to top, #000 70%, transparent); mask-image:linear-gradient(to top, #000 70%, transparent)"></div>}
            <div class={v.composerInnerClass} style={v.composerInnerStyle}>
            <div style="position:relative">
              {v.wontRun && (
                <div style="position:absolute; bottom:calc(100% + 10px); left:0; right:0; border:1px solid oklch(0.55 0.19 25 / .3); background:var(--c-warn-bg); border-radius:14px; padding:14px 18px; box-shadow:0 6px 24px rgba(0,0,0,.08); z-index:15">
                  <div style="font-weight:600; font-size:14px; color:oklch(0.5 0.18 25)">This combination won't run</div>
                  <div style="font-size:13.5px; color:var(--c-text-sec); margin-top:4px; line-height:1.55">{v.wontRunDetail}</div>
                  {v.suggShow && (
                    <button onClick={v.applySugg} class="hv-accent" style="margin-top:10px; background:var(--c-bg); border:1px solid oklch(0.62 0.17 30 / .45); color:oklch(0.52 0.17 30); border-radius:99px; padding:7px 15px; font-size:13px; font-weight:500; cursor:pointer">{v.suggLabel}</button>
                  )}
                </div>
              )}
            </div>
            <div style="border:1.5px solid var(--c-border-strong); border-radius:28px; box-shadow:0 4px 20px rgba(0,0,0,.05); background:var(--c-bg); overflow:hidden">
              <textarea value={v.promptText} onInput={v.setCustom} rows={v.taRows} placeholder={v.taPlaceholder} style={v.taStyle}></textarea>
              <div style="display:flex; align-items:center; gap:6px; padding:10px 12px 12px">
                {v.collapse && (
                  <button onClick={v.toggleCfgPanel} title="Configuration" class="hv-ink" style={v.cfgToggleStyle}>
                    <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
                  </button>
                )}
                {v.showCompareComposer && (
                  <button onClick={v.addCompare} class="hv-ink" style="display:inline-flex; align-items:center; gap:5px; background:none; border:1px solid var(--c-border); color:var(--c-text-sec); border-radius:99px; padding:7px 13px; font-size:12.5px; cursor:pointer; flex-shrink:0">⇄ Compare</button>
                )}
                <span style={v.customChipStyle}>{v.promptTokLabel}</span>
                <button onClick={v.runOrStop} style={v.runBtnStyle}>{v.runLabel}</button>
              </div>
            </div>
            {!v.collapse && this.renderConfigBlock(v)}
            </div>
          </div>
    )
  }

  renderConfigBlock(v: ReturnType<App['renderVals']>) {
    return (
      <>
            {v.cfgRows.map((r, i) => (
              <div key={i} style="display:flex; align-items:center; gap:6px; margin-top:10px; flex-wrap:wrap">
                {r.showBadge && <span style={r.rowBadgeStyle}>{r.rowBadge}</span>}
                {r.showPreset && (
                  <div style="position:relative; min-width:0; flex-shrink:1">
                    <button onClick={v.togglePresetDd} class="hv-border" style="display:flex; align-items:center; gap:7px; background:var(--c-bg-subtle); border:1px solid var(--c-border); border-radius:99px; padding:7px 12px 7px 11px; font-size:12.5px; font-weight:500; cursor:pointer; color:var(--c-text-strong); max-width:100%">
                      <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="var(--c-text-muted)" strokeWidth={1.3} style="flex-shrink:0"><path d="M3 2.5h10M3 5.5h10M3 8.5h6M3 12.5h4" strokeLinecap="round" /></svg>
                      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{v.presetName}</span>
                      <span style="color:var(--c-text-faint); font-size:9px">▾</span>
                    </button>
                    {v.presetDdOpen && (
                      <div ref={this._menuRef} style={`position:absolute; ${v.menuAnchor}; left:0; width:min(280px, calc(100vw - 48px)); background:var(--c-bg); border:1px solid var(--c-border); border-radius:14px; box-shadow:0 8px 30px rgba(0,0,0,.1); z-index:30; padding:6px; display:flex; flex-direction:column`}>
                        {v.presetOpts.map((o, j) => (
                          <button key={j} onClick={o.pick} class="hv-bg" style={o.style}><span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{o.name}</span><span style="font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--c-text-faint); flex-shrink:0">{o.meta}</span></button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div style="position:relative; min-width:0; flex-shrink:1">
                  <button onClick={r.toggleHwDd} class="hv-border" style="display:flex; align-items:center; gap:7px; background:var(--c-bg-subtle); border:1px solid var(--c-border); border-radius:99px; padding:7px 12px 7px 11px; font-size:12.5px; font-weight:500; cursor:pointer; color:var(--c-text-strong); max-width:100%">
                    <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="var(--c-text-muted)" strokeWidth={1.3} style="flex-shrink:0"><rect x={3.5} y={3.5} width={9} height={9} rx={1.5} /><rect x={6} y={6} width={4} height={4} rx={0.5} /><path d="M5.5 1v2.5M8 1v2.5M10.5 1v2.5M5.5 12.5V15M8 12.5V15M10.5 12.5V15M1 5.5h2.5M1 8h2.5M1 10.5h2.5M12.5 5.5H15M12.5 8H15M12.5 10.5H15" /></svg>
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{r.hwName}</span>
                    <span style="color:var(--c-text-faint); font-size:9px">▾</span>
                  </button>
                  {r.hwDdOpen && (
                    <div ref={this._menuRef} style={`position:absolute; ${v.menuAnchor}; left:0; width:min(284px, calc(100vw - 48px)); background:var(--c-bg); border:1px solid var(--c-border); border-radius:14px; box-shadow:0 8px 30px rgba(0,0,0,.1); z-index:30; padding:6px; max-height:320px; display:flex; flex-direction:column`}>
                      <div style="display:flex; gap:4px; padding:4px 4px 8px">
                        <span style="font-size:11px; color:var(--c-text-faint); padding:4px 6px 0">Sort by</span>
                        {r.hwSortBtns.map(t => <button key={t.label} onClick={t.pick} style={t.style}>{t.label}</button>)}
                      </div>
                      <div style="overflow-y:auto; display:flex; flex-direction:column">
                        {r.hwOpts.map((o, j) => o.hdr
                          ? <div key={j} style={o.hdrStyle}><span style={o.dotStyle}></span>{o.label}</div>
                          : <button key={j} onClick={o.pick} class="hv-bg" style={o.style}><span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{o.name}</span><span style="font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--c-text-faint); flex-shrink:0">{o.meta}</span></button>)}
                      </div>
                    </div>
                  )}
                </div>
                <div style="position:relative; min-width:0; flex-shrink:1">
                  <button onClick={r.toggleModelDd} class="hv-border" style="display:flex; align-items:center; gap:7px; background:var(--c-bg-subtle); border:1px solid var(--c-border); border-radius:99px; padding:7px 12px 7px 11px; font-size:12.5px; font-weight:500; cursor:pointer; color:var(--c-text-strong); max-width:100%">
                    <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="var(--c-text-muted)" strokeWidth={1.3} style="flex-shrink:0"><path d="M8 1.5l1.4 3.6a2 2 0 001.5 1.5l3.6 1.4-3.6 1.4a2 2 0 00-1.5 1.5L8 14.5l-1.4-3.6a2 2 0 00-1.5-1.5L1.5 8l3.6-1.4a2 2 0 001.5-1.5L8 1.5z" strokeLinejoin="round" /></svg>
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{r.modelName}</span>
                    <span style="color:var(--c-text-faint); font-size:9px">▾</span>
                  </button>
                  {r.modelDdOpen && (
                    <div ref={this._menuRef} style={`position:absolute; ${v.menuAnchor}; left:0; width:min(284px, calc(100vw - 48px)); background:var(--c-bg); border:1px solid var(--c-border); border-radius:14px; box-shadow:0 8px 30px rgba(0,0,0,.1); z-index:30; padding:6px; max-height:320px; display:flex; flex-direction:column`}>
                      <div style="display:flex; gap:4px; padding:4px 4px 8px">
                        <span style="font-size:11px; color:var(--c-text-faint); padding:4px 6px 0">Sort by</span>
                        {r.modelSortBtns.map(t => <button key={t.label} onClick={t.pick} style={t.style}>{t.label}</button>)}
                      </div>
                      <div style="overflow-y:auto; display:flex; flex-direction:column">
                        {r.modelOpts.map((o, j) => o.hdr
                          ? <div key={j} style={o.hdrStyle}><span style={o.dotStyle}></span>{o.label}</div>
                          : <button key={j} onClick={o.pick} class="hv-bg" style={o.style}><span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{o.name}</span><span style="font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--c-text-faint); flex-shrink:0">{o.meta}</span></button>)}
                      </div>
                    </div>
                  )}
                </div>
                <div style="position:relative; flex-shrink:0">
                  <button onClick={r.toggleQuantDd} class="hv-border" style="display:flex; align-items:center; gap:7px; background:var(--c-bg-subtle); border:1px solid var(--c-border); border-radius:99px; padding:7px 12px 7px 11px; font-size:12px; font-weight:500; cursor:pointer; color:var(--c-text-strong); font-family:'IBM Plex Mono',monospace">
                    <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="var(--c-text-muted)" strokeWidth={1.3} style="flex-shrink:0"><path d="M2 5h5M11 5h3M2 11h2M8 11h6" strokeLinecap="round" /><circle cx={9} cy={5} r={1.8} /><circle cx={6} cy={11} r={1.8} /></svg>
                    <span>{r.quantName}</span>
                    <span style="color:var(--c-text-faint); font-size:9px">▾</span>
                  </button>
                  {r.quantDdOpen && (
                    <div ref={this._menuRef} style={`position:absolute; ${v.menuAnchor}; left:0; width:min(250px, calc(100vw - 48px)); background:var(--c-bg); border:1px solid var(--c-border); border-radius:14px; box-shadow:0 8px 30px rgba(0,0,0,.1); z-index:30; padding:6px; display:flex; flex-direction:column`}>
                      {r.quantOpts.map((o, j) => (
                        <button key={j} onClick={o.pick} class="hv-bg" style={o.style}><span style="font-family:'IBM Plex Mono',monospace">{o.name}</span><span style="font-size:11px; color:var(--c-text-faint); flex-shrink:0">{o.meta}</span></button>
                      ))}
                    </div>
                  )}
                </div>
                {r.showQuantTip && (
                  <span style="position:relative; display:inline-flex; flex-shrink:0">
                    <span onMouseEnter={r.tipQuantOn} onMouseLeave={v.tipOff} class="hv-help" style="width:17px; height:17px; border-radius:50%; border:1px solid var(--c-border-strong); color:var(--c-text-faint); font-size:11px; display:inline-flex; align-items:center; justify-content:center; cursor:help">?</span>
                    {r.tipQuant && (
                      <span ref={this._menuRef} style={`position:absolute; ${v.tipAnchorQuant}; left:50%; transform:translateX(-50%); width:min(250px, calc(100vw - 48px)); background:var(--c-ink); color:var(--c-bg-muted); font-size:12px; line-height:1.5; padding:9px 12px; border-radius:10px; z-index:20; pointer-events:none`}>{r.quantHelp}</span>
                    )}
                  </span>
                )}
                {r.showFitBadge && (
                  <span onMouseEnter={r.tipFitOn} onMouseLeave={v.tipOff} style={r.fitChipStyle}>
                    {r.fitIsFits && <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5}><circle cx={8} cy={8} r={6.4} /><path d="M5.2 8.2l2 2 3.6-4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    {r.fitIsPartial && <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5}><circle cx={8} cy={8} r={6.4} /><path d="M8 1.6 A6.4 6.4 0 0 1 8 14.4 Z" fill="currentColor" stroke="none" /></svg>}
                    {r.fitIsNo && <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5}><circle cx={8} cy={8} r={6.4} /><path d="M3.5 12.5l9-9" strokeLinecap="round" /></svg>}
                    {r.fitLabel}
                    {r.showMeter && (
                      <span style="width:38px; height:5px; border-radius:3px; background:var(--c-border); overflow:hidden; display:inline-block"><span style={r.meterFillStyle}></span></span>
                    )}
                    {r.tipFit && (
                      <span style="position:absolute; bottom:36px; right:0; width:min(250px, calc(100vw - 48px)); background:var(--c-ink); color:var(--c-bg-muted); font-size:12px; line-height:1.5; padding:9px 12px; border-radius:10px; z-index:20; pointer-events:none; font-weight:400">{r.fitHelp}</span>
                    )}
                  </span>
                )}
                {r.showRemove && (
                  <button onClick={v.removeCompare} class="hv-text-ink" style="background:none; border:none; color:var(--c-text-faint); font-size:15px; cursor:pointer; padding:2px 4px; flex-shrink:0; line-height:1">×</button>
                )}
                {r.showAddRace && (
                  <button onClick={v.addCompare} class="hv-dash" style="display:inline-flex; align-items:center; gap:5px; background:none; border:1px dashed var(--c-border-strong); color:var(--c-text-muted); border-radius:99px; padding:7px 12px; font-size:12px; cursor:pointer; flex-shrink:0; white-space:nowrap">+ Race a config</button>
                )}
              </div>
            ))}
            <div style="display:flex; align-items:center; gap:16px; margin-top:12px; flex-wrap:wrap; min-height:29px">
              {v.statRows.map((st, i) => (
                <span key={i} style="display:inline-flex; align-items:center; gap:10px">
                  {st.showBadge && <span style={st.badgeStyle}>{st.badge}</span>}
                  <span style="display:inline-flex; align-items:center; gap:5px">
                    <span style="font-family:'IBM Plex Mono',monospace; font-size:12.5px; color:var(--c-text-muted)">{st.range} tok/s</span>
                    {st.showTips && (
                      <span style="position:relative; display:inline-flex">
                        <span onMouseEnter={v.tipTokOn} onMouseLeave={v.tipOff} class="hv-help" style="width:15px; height:15px; border-radius:50%; border:1px solid var(--c-border-strong); color:var(--c-text-faint); font-size:10px; display:inline-flex; align-items:center; justify-content:center; cursor:help">?</span>
                        {v.tipTok && (
                          <span ref={this._menuRef} style={`position:absolute; ${v.tipAnchorStat}; left:50%; transform:translateX(-50%); width:min(240px, calc(100vw - 48px)); background:var(--c-ink); color:var(--c-bg-muted); font-size:12px; line-height:1.5; padding:9px 12px; border-radius:10px; z-index:20; pointer-events:none`}>{v.tokHelp}</span>
                        )}
                      </span>
                    )}
                  </span>
                  <span style="display:inline-flex; align-items:center; gap:5px">
                    <span style="font-family:'IBM Plex Mono',monospace; font-size:12.5px; color:var(--c-text-muted)">TTFT {st.ttft}</span>
                    {st.showTips && (
                      <span style="position:relative; display:inline-flex">
                        <span onMouseEnter={v.tipTtftOn} onMouseLeave={v.tipOff} class="hv-help" style="width:15px; height:15px; border-radius:50%; border:1px solid var(--c-border-strong); color:var(--c-text-faint); font-size:10px; display:inline-flex; align-items:center; justify-content:center; cursor:help">?</span>
                        {v.tipTtft && (
                          <span ref={this._menuRef} style={`position:absolute; ${v.tipAnchorStat}; left:50%; transform:translateX(-50%); width:min(240px, calc(100vw - 48px)); background:var(--c-ink); color:var(--c-bg-muted); font-size:12px; line-height:1.5; padding:9px 12px; border-radius:10px; z-index:20; pointer-events:none`}>{v.ttftHelp}</span>
                        )}
                      </span>
                    )}
                  </span>
                  <span style="display:inline-flex; align-items:center; gap:5px">
                    <span style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--c-text-muted)"><span style={st.confDotStyle}></span>{st.confLabel}</span>
                    {st.showTips && (
                      <span style="position:relative; display:inline-flex">
                        <span onMouseEnter={v.tipConfOn} onMouseLeave={v.tipOff} class="hv-help" style="width:15px; height:15px; border-radius:50%; border:1px solid var(--c-border-strong); color:var(--c-text-faint); font-size:10px; display:inline-flex; align-items:center; justify-content:center; cursor:help">?</span>
                        {v.tipConf && (
                          <span ref={this._menuRef} style={`position:absolute; ${v.tipAnchorStat}; left:50%; transform:translateX(-50%); width:min(250px, calc(100vw - 48px)); background:var(--c-ink); color:var(--c-bg-muted); font-size:12px; line-height:1.5; padding:9px 12px; border-radius:10px; z-index:20; pointer-events:none`}>{v.confHelp}</span>
                        )}
                      </span>
                    )}
                  </span>
                </span>
              ))}
              <div style="margin-left:auto; display:flex; align-items:center; gap:12px">
                {v.showCompareBtn && (
                  <button onClick={v.addCompare} class="hv-ink" style="background:none; border:1px solid var(--c-border); color:var(--c-text-sec); border-radius:99px; padding:5px 12px; font-size:12px; cursor:pointer">⇄ Compare</button>
                )}
                {v.showShareBtn && <button onClick={v.share} style={v.shareBtnStyle}>{v.shareLabel}</button>}
                {v.showReplay && (
                  <button onClick={v.replay} class="hv-ink" style="background:none; border:1px solid var(--c-border); color:var(--c-text-sec); border-radius:99px; padding:5px 12px; font-size:12px; cursor:pointer">↺ Replay</button>
                )}
                <button onClick={v.toggleBreakdown} class="hv-text-ink" style="background:none; border:none; color:var(--c-text-faint); font-size:12px; cursor:pointer; padding:4px 0">{v.breakdownToggleLabel}</button>
              </div>
            </div>
            {v.breakdownOpen && (
              <div style={v.breakdownWrapStyle}>
                {v.breakdownSecs.map((sec, i) => (
                  <div key={i}>
                    {sec.showLabel && (
                      <div style="font-size:11px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; color:var(--c-text-muted); margin-bottom:8px">{sec.label}</div>
                    )}
                    <div style="display:flex; flex-direction:column; gap:8px">
                      {sec.rows.map(b => (
                        <div key={b.n} style="display:flex; gap:14px; align-items:baseline; font-family:'IBM Plex Mono',monospace; font-size:12px">
                          <span style="color:var(--c-text-faint); width:16px; flex-shrink:0">{b.n}</span>
                          <span style="color:var(--c-text-sec); flex:1">{b.f}</span>
                          <span style="color:var(--c-ink); white-space:nowrap">{b.v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div style="font-size:11.5px; color:var(--c-text-faint); display:flex; gap:16px; flex-wrap:wrap">
                  <span><span style="color:oklch(0.55 0.15 155)">●</span> measured on real hardware</span>
                  <span><span style="color:oklch(0.68 0.13 85)">●</span> derived from nearby benchmarks</span>
                  <span><span style="color:oklch(0.66 0.16 55)">●</span> projected from specs alone</span>
                </div>
              </div>
            )}
      </>
    )
  }
}
