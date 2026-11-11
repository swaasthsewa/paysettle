"use client";
/**
 * F3 · "Built on PayPal", the landing page's centrepiece: one PayPal authorization and a partial capture per milestone,
 * told as a pinned, scroll-driven motion graphic.
 *
 *   The client approves in PayPal and the tranche pours into the PayPal hold. A 26-day hold clock runs along the top;
 *   as each milestone's day arrives, its slice lifts out of the hold and arcs to the provider (a partial capture). One
 *   capture meets a 503 and is retried with the same idempotency key: still one capture. M04 is disputed and stays held.
 *   The last paid capture is final; the unused share is voided back to the client. Counters below the title add up to
 *   the tranche, and PaySettle sits underneath as a dashed box that only sends instructions.
 *
 * Amounts come from the Web / SaaS MVP blueprint (example.ts); days are its milestone days. Pinned with position: sticky
 * (no transformed ancestor needed). Without script or under reduced motion the final state is drawn in place.
 */
import { useEffect, useRef, type CSSProperties } from "react";
import { RAIL_CAP_DAYS } from "@/lib/policy";
import { EXAMPLE_SHARES, EXAMPLE_TOTAL, sumOf, usd } from "./example";

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p: number, a: number, b: number) => { const t = clamp((p - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const CAP = RAIL_CAP_DAYS.A1;
/* geometry, viewBox 1000 × 600 */
const TL = { x0: 130, x1: 870, y: 70 };
const CLIENT = { x: 110, y: 330 }, PROVIDER = { x: 890, y: 330 }, VAULT = { x: 355, y: 170, w: 290, h: 300 };
const STACK = { x: 385, w: 230, y1: 448, h: 200 };
const dayX = (d: number) => TL.x0 + ((TL.x1 - TL.x0) * d) / CAP;

const FILL: [number, number] = [0.03, 0.13];
const CLOCK: [number, number] = [0.12, 0.86];
const OUTRO: [number, number] = [0.86, 0.95];
const LAST_PAID = [...EXAMPLE_SHARES].reverse().find((s) => s.end === "released")?.code;

/** Each slice's place in the stack (bottom up) and when it moves: it leaves as the clock passes its day. */
const SLICES = (() => {
  let y = STACK.y1;
  return EXAMPLE_SHARES.map((s, k) => {
    const h = (STACK.h * s.cents) / EXAMPLE_TOTAL;
    y -= h;
    const at = CLOCK[0] + ((CLOCK[1] - CLOCK[0]) * s.day) / CAP;
    return { ...s, k, y, h, win: [at - 0.075, at] as [number, number], retry: s.code === "M03", final: s.code === LAST_PAID };
  });
})();
const chipText = (s: (typeof SLICES)[number]) =>
  s.end === "frozen" ? `${s.code} · dispute: stays held` : s.end === "returned" ? `void ${usd(s.cents)} → client` : `${s.final ? "final capture" : "capture"} ${usd(s.cents)}`;

export function PaypalScene() {
  const root = useRef<HTMLElement | null>(null);
  const slices = useRef<Array<SVGGElement | null>>([]);
  const chips = useRef<Array<SVGGElement | null>>([]);
  const chipT = useRef<Array<SVGTextElement | null>>([]);
  const coins = useRef<Array<SVGCircleElement | null>>([]);
  const marker = useRef<SVGGElement | null>(null);
  const dayT = useRef<SVGTextElement | null>(null);
  const held = useRef<HTMLElement | null>(null);
  const cap = useRef<HTMLElement | null>(null);
  const voided = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const level = document.documentElement.dataset.motion;
    if (level === "calm" || level === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.classList.add("is-live");

    const render = (p: number) => {
      const fill = seg(p, ...FILL);
      const clock = clamp((p - CLOCK[0]) / (CLOCK[1] - CLOCK[0]));
      el.style.setProperty("--p", p.toFixed(3));
      el.style.setProperty("--fill", fill.toFixed(3));
      el.style.setProperty("--o", seg(p, ...OUTRO).toFixed(3));
      el.style.setProperty("--auth", (seg(p, 0, FILL[0] + 0.02) * (1 - seg(p, 0.16, 0.2))).toFixed(3));
      // the hold clock
      const day = CAP * clock;
      marker.current?.setAttribute("transform", `translate(${dayX(day).toFixed(1)} ${TL.y})`);
      if (dayT.current) dayT.current.textContent = `Day ${Math.round(day)}`;
      // coins pour from the client into the hold
      coins.current.forEach((c, i) => {
        if (!c) return;
        const t = clamp(fill * 1.6 - i * 0.12);
        const x = lerp(CLIENT.x + 40, VAULT.x + 30, t), y = CLIENT.y - Math.sin(Math.PI * t) * 60;
        c.setAttribute("cx", x.toFixed(1)); c.setAttribute("cy", y.toFixed(1));
        c.setAttribute("opacity", (t > 0 && t < 1 ? 1 : 0).toString());
      });
      let captured = 0, back = 0;
      SLICES.forEach((s, k) => {
        const g = slices.current[k];
        const t = seg(p, s.win[0], s.win[1]);
        const moves = s.end !== "frozen";
        const to = s.end === "returned" ? CLIENT : PROVIDER;
        const fx = STACK.x + STACK.w / 2, fy = s.y + s.h / 2;
        // the 503 hits half-way along the arc; the retry with the same key carries on
        const tt = s.retry ? (t < 0.45 ? t : t < 0.6 ? 0.45 : 0.45 + (t - 0.6) / 0.4 * 0.55) : t;
        const dx = moves ? (to.x - fx) * tt : 0;
        const dy = moves ? (to.y - fy) * tt - Math.sin(Math.PI * tt) * (s.end === "returned" ? -110 : 130) : 0;
        const sc = moves ? 1 - 0.55 * tt : 1;
        if (g) {
          g.setAttribute("transform", `translate(${dx.toFixed(1)} ${dy.toFixed(1)}) translate(${fx} ${fy}) scale(${sc.toFixed(3)}) translate(${-fx} ${-fy})`);
          g.style.opacity = moves ? (1 - seg(t, 0.9, 1)).toFixed(3) : "1";
          g.classList.toggle("is-frozen", !moves && t > 0.05);
          g.classList.toggle("is-moving", moves && t > 0.02 && t < 1);
        }
        const chip = chips.current[k];
        if (chip) {
          const show = t > 0.05 && (moves ? t < 0.98 : true) && p < OUTRO[0] + 0.02;
          chip.style.opacity = show ? "1" : "0";
          const cx = moves ? fx + (to.x - fx) * 0.63 : fx + 245, cy = moves ? (s.end === "returned" ? 486 : 150) : fy;
          chip.setAttribute("transform", `translate(${cx.toFixed(1)} ${cy.toFixed(1)})`);
          const label = chipT.current[k];
          if (label) {
            const failing = s.retry && t > 0.3 && t < 0.6;
            chip.classList.toggle("is-error", failing);
            label.textContent = failing ? "⚡ 503 · retry, same key" : chipText(s);
          }
        }
        if (s.end === "released") captured += s.cents * seg(t, 0.85, 1);
        if (s.end === "returned") back += s.cents * seg(t, 0.85, 1);
      });
      const inHold = EXAMPLE_TOTAL * fill - captured - back;
      if (held.current) held.current.textContent = usd(Math.round(inHold / 100) * 100);
      if (cap.current) cap.current.textContent = usd(Math.round(captured / 100) * 100);
      if (voided.current) voided.current.textContent = usd(Math.round(back / 100) * 100);
    };

    let raf = 0, listening = false;
    const measure = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      render(clamp(-r.top / Math.max(1, r.height - window.innerHeight)));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !listening) { window.addEventListener("scroll", onScroll, { passive: true }); window.addEventListener("resize", onScroll); listening = true; onScroll(); }
      else if (!e.isIntersecting && listening) { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); listening = false; }
    }, { rootMargin: "200px 0px" });
    io.observe(el);
    measure();
    return () => {
      io.disconnect(); cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll);
      el.classList.remove("is-live");
    };
  }, []);

  const finalHeld = sumOf("frozen"), finalCap = sumOf("released"), finalVoid = sumOf("returned");
  return (
    <section ref={root} id="paypal" className="pp" aria-labelledby="pp-h">
      <div className="pp-stage">
        <div className="pp-bg" aria-hidden="true"><div className="pp-dots" /><div className="pp-glow" /></div>
        <div className="lp-wrap pp-grid">
          <div className="pp-copy">
            <p className="pp-kicker">Built on PayPal</p>
            <h2 id="pp-h" className="pp-title">One hold.<br />A capture per milestone.</h2>
            <dl className="pp-counters">
              <div className="pp-c pp-c-held"><dt>Held in PayPal</dt><dd ref={held}>{usd(finalHeld)}</dd></div>
              <div className="pp-c pp-c-cap"><dt>Captured to provider</dt><dd ref={cap}>{usd(finalCap)}</dd></div>
              <div className="pp-c pp-c-void"><dt>Voided to client</dt><dd ref={voided}>{usd(finalVoid)}</dd></div>
            </dl>
            <p className="pp-sum"><span>= {usd(EXAMPLE_TOTAL)}</span> reconciled to the cent</p>
            <ul className="pp-api" aria-label="PayPal calls in this story">
              <li style={{ "--a": 0.02 } as CSSProperties}>orders · AUTHORIZE</li>
              <li style={{ "--a": 0.2 } as CSSProperties}>authorizations/capture</li>
              <li style={{ "--a": 0.35 } as CSSProperties}>PayPal-Request-Id</li>
              <li style={{ "--a": 0.7 } as CSSProperties}>final_capture</li>
              <li style={{ "--a": 0.8 } as CSSProperties}>void</li>
              <li style={{ "--a": 0.88 } as CSSProperties}>webhooks · verified</li>
            </ul>
          </div>

          <svg className="pp-art" viewBox="50 20 900 580" role="img" aria-label={`A ${usd(EXAMPLE_TOTAL)} PayPal authorization on a ${CAP}-day hold. Milestones M02, M03, M05 and M06 are captured to the provider as their days arrive, one capture retried after a 503 with the same key; M04 is disputed and stays held; M07 is voided back to the client. PaySettle only sends instructions.`}>
            {/* the hold clock */}
            <g className="pp-clock">
              <line x1={TL.x0} y1={TL.y} x2={TL.x1} y2={TL.y} className="pp-tl" />
              <text x={TL.x0} y={TL.y + 30} className="pp-mono pp-dim">Day 0</text>
              <text x={(TL.x0 + TL.x1) / 2} y={TL.y + 56} textAnchor="middle" className="pp-mono pp-dim pp-window">one authorization · {CAP}-day hold window</text>
              {EXAMPLE_SHARES.map((s) => (
                <g key={s.code} transform={`translate(${dayX(s.day)} ${TL.y})`}>
                  <line y1={-7} y2={7} className={`pp-tick pp-tick-${s.end}`} />
                  <text y={-14} textAnchor="middle" className="pp-mono pp-code">{s.code}</text>
                </g>
              ))}
              <g ref={marker} className="pp-marker" transform={`translate(${TL.x1} ${TL.y})`}>
                <circle r="7" />
                <text ref={dayT} y="32" textAnchor="middle" className="pp-mono">Day {CAP}</text>
              </g>
            </g>

            {/* client and provider */}
            <g className="pp-actor pp-actor-c" transform={`translate(${CLIENT.x} ${CLIENT.y})`}>
              <circle r="42" /><circle cy="-10" r="11" className="pp-glyph" /><path d="M-19 20 a19 15 0 0 1 38 0" className="pp-glyph" />
              <text y="70" textAnchor="middle">Client</text>
            </g>
            <g className="pp-actor pp-actor-p" transform={`translate(${PROVIDER.x} ${PROVIDER.y})`}>
              <circle r="42" /><circle cy="-10" r="11" className="pp-glyph" /><path d="M-19 20 a19 15 0 0 1 38 0" className="pp-glyph" />
              <text y="70" textAnchor="middle">Provider</text>
            </g>
            <g className="pp-approve" transform={`translate(${CLIENT.x} ${CLIENT.y - 78})`}>
              <rect x="-62" y="-15" width="124" height="30" rx="15" />
              <text y="5" textAnchor="middle">✓ approve in PayPal</text>
            </g>
            {[0, 1, 2, 3, 4].map((i) => <circle key={i} ref={(n) => { coins.current[i] = n; }} r="7" className="pp-coin" cx={-50} cy={-50} opacity="0" />)}

            {/* the PayPal hold */}
            <g className="pp-vault">
              <rect x={VAULT.x} y={VAULT.y} width={VAULT.w} height={VAULT.h} rx="26" className="pp-vault-box" />
              <rect x={VAULT.x - 8} y={VAULT.y - 8} width={VAULT.w + 16} height={VAULT.h + 16} rx="32" className="pp-vault-ring" />
              <text x={VAULT.x + VAULT.w / 2} y={VAULT.y + 32} textAnchor="middle" className="pp-vault-t">PayPal</text>
              <text x={VAULT.x + VAULT.w / 2} y={VAULT.y + 50} textAnchor="middle" className="pp-mono pp-dim">authorization · held</text>
              <rect x={STACK.x - 4} y={STACK.y1 - STACK.h - 4} width={STACK.w + 8} height={STACK.h + 8} rx="10" className="pp-stack-bg" />
            </g>
            {SLICES.map((s, k) => (
              <g key={s.code} ref={(n) => { slices.current[k] = n; }} className={`pp-slice pp-slice-${s.end}`}>
                <rect x={STACK.x} y={s.y + 1} width={STACK.w} height={s.h - 2} rx="5" />
                <text x={STACK.x + 10} y={s.y + s.h / 2 + 4} className="pp-slice-t">{s.code}</text>
                <text x={STACK.x + STACK.w - 10} y={s.y + s.h / 2 + 4} textAnchor="end" className="pp-slice-t">{usd(s.cents)}</text>
                {s.end === "frozen" && <g className="pp-lock" transform={`translate(${STACK.x + STACK.w + 22} ${s.y + s.h / 2})`}><rect x="-8" y="-3" width="16" height="12" rx="2" /><path d="M-5 -3 v-4 a5 5 0 0 1 10 0 v4" /></g>}
              </g>
            ))}
            {SLICES.map((s, k) => (
              <g key={s.code} ref={(n) => { chips.current[k] = n; }} className={`pp-chip pp-chip-${s.end}`} style={{ opacity: 0 }}>
                <rect x="-92" y="-15" width="184" height="30" rx="15" />
                <text ref={(n) => { chipT.current[k] = n; }} y="5" textAnchor="middle">{chipText(s)}</text>
              </g>
            ))}

            {/* PaySettle: instructions only */}
            <g className="pp-orch">
              {[440, 500, 560].map((x) => <path key={x} d={`M${x} 512 V ${VAULT.y + VAULT.h + 12}`} className="pp-instr" />)}
              <rect x="410" y="512" width="180" height="40" rx="12" className="pp-orch-box" />
              <text x="500" y="537" textAnchor="middle" className="pp-orch-t">PaySettle</text>
              <text x="500" y="578" textAnchor="middle" className="pp-mono pp-dim pp-orch-cap">sends instructions · never holds the money</text>
            </g>
          </svg>
        </div>
      </div>
    </section>
  );
}
