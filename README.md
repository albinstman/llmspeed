# llmspeed

**[llmspeed.dev](https://llmspeed.dev)** — feel how fast a local LLM runs before you buy the hardware.

Pick a GPU (or Mac), a model, and a quantization level, then watch a simulated response stream at the token rate that combination actually produces. Compare two configurations side by side, see time-to-first-token, and expand "How we calculated this" for the math behind every number.

## How it works

Decode speed for local inference is dominated by memory bandwidth: every generated token reads the model's active weights once. The simulator estimates

- **memory fit** — weights (params × bits per weight) + KV cache vs. usable VRAM/unified memory, including partial-offload penalties when a model spills to system RAM
- **decode rate** — bandwidth × efficiency ÷ active weight bytes
- **TTFT** — prompt length ÷ prefill throughput

and streams a canned response at that rate, with realistic jitter.

> ⚠️ The current hardware/model numbers are placeholder estimates ported from the design mockup. Curated benchmark data is the next step — see `src/data.ts`.

## Development

```bash
npm install
npm run dev        # dev server with hot reload
npm run build      # production build to dist/
npm run typecheck  # tsc --noEmit
```

Stack: [Preact](https://preactjs.com) + [Vite](https://vite.dev) + TypeScript, no other runtime dependencies. Pushes to `main` deploy to GitHub Pages (served at llmspeed.dev) via `.github/workflows/deploy.yml`.

## Share links

Configurations are encoded in the URL, e.g.

```
https://llmspeed.dev/?hw=rtx4090,m4pro&model=llama31-8b,llama31-8b&quant=q4,q4&preset=0&run=1
```

`hw`/`model`/`quant` take ids from `src/data.ts` (comma-separated for a two-way race), `preset` picks a sample prompt, `prompt` carries custom text, and `run=1` starts the simulation on load.
