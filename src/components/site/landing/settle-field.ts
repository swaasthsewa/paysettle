/**
 * F3 · the landing hero's settlement field: a few KB of canvas, no library. Money pulses leave the client, wait in the
 * PayPal hold, then travel to one milestone's evidence check. A check that passes lets the pulse through to the provider
 * (teal turns amber: held becomes paid); one that fails freezes that pulse alone, and the other milestones carry on.
 * Runs on phones too, pauses off screen and in background tabs, and draws one still frame under reduced motion.
 */

type Pt = { x: number; y: number };
type Pulse = { ms: number; t: number; fail: boolean; frozenAt?: number; done?: boolean };

export interface SettleField { destroy(): void }

const TEAL = "45,212,191", AMBER = "245,165,36", RED = "248,113,113", INK = "226,232,240", DIM = "148,163,184";
const CODES = ["M02", "M03", "M04", "M05", "M06"];
const DWELL = 0.16; // share of a pulse's life spent held in PayPal

export function startSettleField(canvas: HTMLCanvasElement): SettleField {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { destroy() {} };
  const g = ctx;
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const font = getComputedStyle(canvas).fontFamily || "sans-serif";
  let W = 0, H = 0, raf = 0, visible = true, last = 0, lastSpawn = 0, seed = 11, wide = true;
  let client: Pt = { x: 0, y: 0 }, vault: Pt = { x: 0, y: 0 }, provider: Pt = { x: 0, y: 0 };
  let gates: Pt[] = [], mss: Pt[] = [];
  const flash = { vault: 0, provider: 0, gates: [0, 0, 0, 0, 0], fails: [0, 0, 0, 0, 0] };
  let pulses: Pulse[] = [];
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  function build() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    wide = W > 900;
    const x0 = wide ? W * 0.53 : W * 0.06, x1 = wide ? W * 0.95 : W * 0.94, span = x1 - x0;
    /* narrow screens: the canvas is only the strip under the copy (landing.css), so the field uses all of it */
    const cy = wide ? H * 0.5 : H * 0.52;
    const top = wide ? H * 0.2 : H * 0.14, bot = wide ? H * 0.8 : H * 0.9;
    client = { x: x0, y: cy };
    vault = { x: x0 + span * 0.24, y: cy };
    provider = { x: x1, y: cy };
    gates = CODES.map((_, i) => ({ x: x0 + span * 0.52, y: top + ((bot - top) * i) / 4 }));
    mss = gates.map((p) => ({ x: x0 + span * 0.74, y: p.y }));
    pulses = [];
  }

  /** The pulse's route: client → vault, (dwell), vault → gate → milestone → provider. */
  function legs(ms: number): Pt[] { return [client, vault, gates[ms], mss[ms], provider]; }
  function curve(a: Pt, b: Pt, f: number): Pt {
    // a horizontal-tangent cubic, matching how the edges are drawn
    const mx = (a.x + b.x) / 2, u = 1 - f;
    return {
      x: u * u * u * a.x + 3 * u * u * f * mx + 3 * u * f * f * mx + f * f * f * b.x,
      y: u * u * u * a.y + 3 * u * u * f * a.y + 3 * u * f * f * b.y + f * f * f * b.y,
    };
  }
  /** Position at life t (0..1): four equal legs around a dwell in the vault. */
  function at(p: Pulse, t: number): Pt {
    const L = legs(p.ms);
    if (t < 0.2) return curve(L[0], L[1], t / 0.2);
    if (t < 0.2 + DWELL) return L[1];
    const r = (t - 0.2 - DWELL) / (1 - 0.2 - DWELL); // 0..1 across the three remaining legs
    const k = Math.min(2, Math.floor(r * 3)), f = r * 3 - k;
    return curve(L[k + 1], L[k + 2], f);
  }
  const GATE_T = 0.2 + DWELL + (1 - 0.2 - DWELL) / 3;

  function edge(a: Pt, b: Pt) { const mx = (a.x + b.x) / 2; g.moveTo(a.x, a.y); g.bezierCurveTo(mx, a.y, mx, b.y, b.x, b.y); }
  function label(text: string, x: number, y: number, align: CanvasTextAlign, alpha: number, size = 12.5, weight = 500) {
    g.font = `${weight} ${size}px ${font}`; g.textAlign = align; g.fillStyle = `rgba(${INK},${alpha})`; g.fillText(text, x, y);
  }

  function draw(dt: number) {
    g.clearRect(0, 0, W, H);
    const base = wide ? 1 : 0.55;
    // edges
    g.lineWidth = 1.2; g.strokeStyle = `rgba(${DIM},${0.16 * base})`; g.beginPath();
    edge(client, vault);
    gates.forEach((p, i) => { edge(vault, p); g.moveTo(p.x, p.y); g.lineTo(mss[i].x, mss[i].y); edge(mss[i], provider); });
    g.stroke();
    // pulses
    for (const p of pulses) {
      if (p.frozenAt === undefined) p.t += dt / 4200; // about 4.2 s from client to provider
      if (p.fail && p.frozenAt === undefined && p.t >= GATE_T) { p.frozenAt = 0; p.t = GATE_T; flash.fails[p.ms] = 1; }
      if (p.frozenAt !== undefined) p.frozenAt += dt;
      if (!p.fail && p.t >= GATE_T && !p.done) { p.done = true; flash.gates[p.ms] = 1; }
      if (p.t >= 0.2 && p.t < 0.2 + DWELL) flash.vault = Math.max(flash.vault, 0.7);
      if (p.t >= 1) flash.provider = 1;
      const fade = p.frozenAt !== undefined ? Math.max(0, 1 - p.frozenAt / 1600) : 1;
      const paid = !p.fail && p.t > GATE_T;
      const col = p.frozenAt !== undefined ? RED : paid ? AMBER : TEAL;
      for (let k = 0; k < 12; k++) {
        const pt = at(p, Math.max(0, p.t - k * 0.006));
        g.fillStyle = `rgba(${col},${(1 - k / 12) * 0.7 * fade * base})`;
        g.beginPath(); g.arc(pt.x, pt.y, 2.8 - k * 0.15, 0, 7); g.fill();
      }
    }
    pulses = pulses.filter((p) => p.t < 1.02 && (p.frozenAt === undefined || p.frozenAt < 1700));
    // client and provider
    flash.provider = Math.max(0, flash.provider - dt / 700);
    flash.vault = Math.max(0, flash.vault - dt / 900);
    g.fillStyle = `rgba(${TEAL},${0.9 * base})`; g.beginPath(); g.arc(client.x, client.y, 7, 0, 7); g.fill();
    g.strokeStyle = `rgba(${TEAL},${0.45 * base})`; g.beginPath(); g.arc(client.x, client.y, 13, 0, 7); g.stroke();
    g.fillStyle = `rgba(${AMBER},${(0.55 + flash.provider * 0.45) * base})`; g.beginPath(); g.arc(provider.x, provider.y, 7 + flash.provider * 3, 0, 7); g.fill();
    g.strokeStyle = `rgba(${AMBER},${0.5 * base})`; g.beginPath(); g.arc(provider.x, provider.y, 13 + flash.provider * 7, 0, 7); g.stroke();
    // the PayPal hold
    const vw = 54, vh = 70;
    g.fillStyle = `rgba(14,21,36,${0.92})`; g.strokeStyle = `rgba(${TEAL},${(0.45 + flash.vault * 0.5) * base})`; g.lineWidth = 1.4;
    g.beginPath(); g.roundRect(vault.x - vw / 2, vault.y - vh / 2, vw, vh, 12); g.fill(); g.stroke();
    g.fillStyle = `rgba(${TEAL},${(0.22 + flash.vault * 0.4) * base})`;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.roundRect(vault.x - 16, vault.y - 18 + i * 13, 32, 8, 3); g.fill(); }
    // evidence checks and milestones
    gates.forEach((p, i) => {
      flash.gates[i] = Math.max(0, flash.gates[i] - dt / 800);
      flash.fails[i] = Math.max(0, flash.fails[i] - dt / 1800);
      const fail = flash.fails[i], ok = flash.gates[i];
      g.save(); g.translate(p.x, p.y); g.rotate(Math.PI / 4);
      g.fillStyle = fail > 0 ? `rgba(${RED},${0.25 + fail * 0.6})` : ok > 0 ? `rgba(${TEAL},${0.25 + ok * 0.7})` : "rgba(14,21,36,.95)";
      g.strokeStyle = fail > 0 ? `rgba(${RED},.9)` : `rgba(${DIM},${0.55 * base})`; g.lineWidth = 1.3;
      g.beginPath(); g.rect(-7, -7, 14, 14); g.fill(); g.stroke(); g.restore();
      const m = mss[i];
      g.fillStyle = `rgba(${DIM},${0.5 * base})`; g.beginPath(); g.arc(m.x, m.y, 4, 0, 7); g.fill();
      if (wide) {
        label(CODES[i], m.x, m.y - 12, "center", 0.7, 11.5, 600);
        if (fail > 0.05) label("frozen: only this share", p.x, p.y + 22, "center", Math.min(1, fail * 1.5), 11, 500);
      }
    });
    if (wide) {
      label("Client funds", client.x, client.y + 32, "center", 0.75);
      label("Held in PayPal", vault.x, vault.y + vh / 2 + 20, "center", 0.85, 12.5, 600);
      label("Evidence checked", gates[0].x, gates[0].y - 26, "center", 0.65, 11.5);
      label("Provider paid", provider.x, provider.y + 32, "right", 0.85, 12.5, 600);
    }
  }

  function spawn() { const fail = rnd() < 0.14; pulses.push({ ms: Math.floor(rnd() * 5), t: 0, fail }); }
  function frame(ts: number) {
    const dt = Math.min(48, ts - (last || ts)); last = ts;
    if (ts - lastSpawn > 520) { spawn(); lastSpawn = ts; }
    draw(dt);
    raf = visible && !document.hidden && !mq.matches ? requestAnimationFrame(frame) : 0;
  }
  function still() {
    pulses = [];
    const ts = [0.1, 0.27, 0.45, 0.62, 0.8, 0.93];
    ts.forEach((t, i) => pulses.push({ ms: i % 5, t, fail: false, done: t > GATE_T }));
    pulses.push({ ms: 2, t: GATE_T, fail: true, frozenAt: 200 });
    flash.fails[2] = 1;
    draw(0);
  }
  function start() {
    if (mq.matches) { still(); return; }
    if (!raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); }
  }
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); });
  io.observe(canvas);
  const onResize = () => { build(); if (mq.matches) still(); };
  document.addEventListener("visibilitychange", start);
  window.addEventListener("resize", onResize);
  mq.addEventListener("change", start);
  build(); start();

  return {
    destroy() {
      cancelAnimationFrame(raf); raf = 0; io.disconnect();
      document.removeEventListener("visibilitychange", start);
      window.removeEventListener("resize", onResize);
      mq.removeEventListener("change", start);
    },
  };
}
