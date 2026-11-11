"use client";
/**
 * F3 · "From a sentence to a settlement": the product's loop as a scroll-driven motion graphic, directly after the hero.
 *
 * Fixed-picture (reveal) parallax: the stage is position: fixed and the section clips it (clip-path), so it behaves as a
 * window the page scrolls past. While the window fills the screen, scrolling plays the graphic: a vague criterion is
 * struck out and rewritten, both parties sign and the revision is sealed, PayPal holds the tranche, and evidence releases
 * each milestone's share, one share frozen in a dispute and one returned to the client. Behind it, four background
 * layers move at different speeds (dots, glows, a giant outlined word, floating labels).
 *
 * No transformed, filtered or contained ancestor may wrap this section: it would become the fixed stage's containing
 * block. Without script, under reduced motion, or with the staff motion setting at calm or off, nothing is pinned and
 * the final composition is shown (CSS defaults every phase to 1). Cost: one scroll listener while the section is near
 * the screen, writing CSS variables once per animation frame (transform and opacity only).
 */
import { useEffect, useRef, type CSSProperties } from "react";
import Link from "next/link";

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p: number, a: number, b: number) => { const t = clamp((p - a) / (b - a)); return t * t * (3 - 2 * t); };

/** The tranche: M02–M06 of the web MVP example, and what happens to each share. */
const SHARES = [
  { code: "M02", cents: 90_000, end: "released" },
  { code: "M03", cents: 120_000, end: "released" },
  { code: "M04", cents: 150_000, end: "frozen" },
  { code: "M05", cents: 90_000, end: "released" },
  { code: "M06", cents: 150_000, end: "returned" },
] as const;
const TOTAL = SHARES.reduce((a, s) => a + s.cents, 0);
const END_LABEL = { released: "Released", frozen: "Frozen", returned: "Returned" } as const;
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US")}`;

/** Phase windows over the progress p (0..1 while the window fills the screen). */
const PH = { a: [0.02, 0.12], b: [0.12, 0.22], c: [0.22, 0.34], d: [0.34, 0.48], f: [0.48, 0.58], o: [0.9, 0.98] } as const;
const SHARE_AT = (k: number): [number, number] => [0.58 + k * 0.06, 0.64 + k * 0.06];

const BAR_X = 40, BAR_W = 520;
/** Each share's place on the bar, in proportion to its amount. */
const SEGS = SHARES.map((s, k) => {
  const x = BAR_X + (BAR_W * SHARES.slice(0, k).reduce((a, t) => a + t.cents, 0)) / TOTAL;
  return { ...s, k, x, w: (BAR_W * s.cents) / TOTAL };
});

export function SettleReveal() {
  const root = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const level = document.documentElement.dataset.motion;
    if (level === "calm" || level === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.classList.add("is-live");

    const render = (p: number) => {
      const st = el.style;
      for (const [k, [a, b]] of Object.entries(PH)) st.setProperty(`--${k}`, seg(p, a, b).toFixed(3));
      SHARES.forEach((_, k) => { const [a, b] = SHARE_AT(k); st.setProperty(`--s${k}`, seg(p, a, b).toFixed(3)); });
      st.setProperty("--p", p.toFixed(4));
      // until the close begins, its links are hidden from focus as well as from sight
      el.classList.toggle("has-outro", seg(p, PH.o[0], PH.o[1]) > 0.02);
    };
    let raf = 0, listening = false;
    const measure = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      render(clamp(-r.top / Math.max(1, r.height - vh)));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    const io = new IntersectionObserver(([e]) => {
      el.classList.toggle("is-near", e.isIntersecting);
      if (e.isIntersecting && !listening) { window.addEventListener("scroll", onScroll, { passive: true }); window.addEventListener("resize", onScroll); listening = true; onScroll(); }
      else if (!e.isIntersecting && listening) { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); listening = false; }
    }, { rootMargin: "200px 0px" });
    io.observe(el);
    measure();
    return () => {
      io.disconnect(); cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll);
      el.classList.remove("is-live", "is-near");
    };
  }, []);

  return (
    <section ref={root} className="lp2-sr" id="settle" aria-labelledby="lp2-sr-h">
      <div className="lp2-sr-stage">
        <div className="lp2-sr-bg" aria-hidden="true">
          <div className="lp2-sr-dots" />
          <div className="lp2-sr-glow g1" /><div className="lp2-sr-glow g2" />
          <div className="lp2-sr-word">SETTLED</div>
          <span className="lp2-sr-float f1">Held in PayPal</span>
          <span className="lp2-sr-float f2">Evidence ✓</span>
          <span className="lp2-sr-float f3">Partial capture</span>
          <span className="lp2-sr-float f4">Idempotency key</span>
          <span className="lp2-sr-float f5">Signed · rev 3</span>
        </div>

        <div className="lp-wrap lp2-sr-grid">
          <div className="lp2-sr-copy">
            <p className="lp2-sr-kicker">From a sentence to a settlement</p>
            <h2 id="lp2-sr-h" className="lp2-sr-statement">
              <span style={{ "--x": "var(--a)" } as CSSProperties}>A vague sentence goes in.</span>
              <span style={{ "--x": "var(--c)" } as CSSProperties}>A <em>checkable</em> clause comes out.</span>
              <span style={{ "--x": "var(--d)" } as CSSProperties}>Both sides sign the same text.</span>
              <span style={{ "--x": "var(--f)" } as CSSProperties}>PayPal <em>holds</em> the money.</span>
              <span style={{ "--x": "var(--s0)" } as CSSProperties}>Evidence <em>releases</em> each share.</span>
            </h2>
            <div className="lp2-sr-outro">
              <p>Only a disputed share is frozen. The rest of the work keeps moving, and keeps getting paid.</p>
              <div className="lp2-ctas lp2-ctas-left">
                <Link className="btn lp2-btn lp2-btn-main" href="/login">Try the live demo</Link>
                <Link className="btn lp2-btn" href="/how-it-works">How it works</Link>
              </div>
            </div>
          </div>

          <svg className="lp2-sr-art" viewBox="0 0 600 600" role="img" aria-label="A vague criterion is struck out and rewritten as a measurable one; client and provider sign and the revision is sealed; PayPal holds a $6,000 tranche; milestones M02, M03 and M05 are released, M04 is frozen in a dispute and M06 is returned to the client.">
            {/* 1 · the vague criterion, struck out */}
            <g className="lp2-sr-in" style={{ "--x": "var(--a)" } as CSSProperties}>
              <rect x="40" y="18" width="520" height="92" rx="16" className="lp2-card" />
              <text x="64" y="54" className="lp2-t-mono lp2-t-dim">Acceptance criterion · as written</text>
              <text x="64" y="84" className="lp2-t-quote">“The website should be fast and modern.”</text>
              <line x1="62" y1="79" x2="404" y2="79" className="lp2-strike" pathLength={1} />
              <g className="lp2-flag">
                <rect x="398" y="38" width="146" height="26" rx="13" />
                <text x="471" y="56" textAnchor="middle">Taste words · no number</text>
              </g>
            </g>
            {/* 2 · the rewrite */}
            <g className="lp2-sr-in" style={{ "--x": "var(--c)" } as CSSProperties}>
              <path d="M300 116 v22" className="lp2-arrow" />
              <path d="M293 132 l7 8 l7 -8" className="lp2-arrow" />
              <rect x="40" y="146" width="520" height="92" rx="16" className="lp2-card lp2-card-ok" />
              <text x="64" y="180" className="lp2-t-mono lp2-t-teal">Rewrite · checkable</text>
              <text x="64" y="210" className="lp2-t-body">Lighthouse mobile score ≥ 85 on staging,</text>
              <text x="64" y="230" className="lp2-t-body lp2-t-dim">report attached as evidence.</text>
              <circle cx="526" cy="192" r="15" className="lp2-tick-c" />
              <path d="M519 192 l5 5 l9 -10" className="lp2-tick" />
            </g>
            {/* 3 · both sign, the revision is sealed */}
            <g style={{ "--x": "var(--d)" } as CSSProperties}>
              <text x="60" y="290" className="lp2-t-mono lp2-t-teal lp2-sr-in">Client</text>
              <text x="540" y="290" textAnchor="end" className="lp2-t-mono lp2-t-amber lp2-sr-in">Provider</text>
              <path d="M60 330 C 110 296, 140 360, 180 322 S 236 300, 262 330" className="lp2-sig lp2-sig-a" pathLength={1} />
              <path d="M540 330 C 490 300, 470 360, 424 326 S 364 302, 338 330" className="lp2-sig lp2-sig-b" pathLength={1} />
              <g className="lp2-seal">
                <circle cx="300" cy="330" r="36" />
                <circle cx="300" cy="330" r="44" className="lp2-seal-ring" />
                <text x="300" y="326" textAnchor="middle" className="lp2-seal-t">Signed</text>
                <text x="300" y="343" textAnchor="middle" className="lp2-t-mono lp2-seal-h">rev 3 · 9f2c…</text>
              </g>
            </g>
            {/* 4 · PayPal holds the tranche, 5 · evidence releases each share */}
            <g className="lp2-sr-in" style={{ "--x": "var(--f)" } as CSSProperties}>
              <text x="40" y="414" className="lp2-t-body"><tspan className="lp2-t-teal" fontWeight="600">{usd(TOTAL)}</tspan> held in PayPal · tranche 1</text>
              <rect x={BAR_X} y="430" width={BAR_W} height="50" rx="12" className="lp2-bar-bg" />
              <rect x={BAR_X} y="430" width={BAR_W} height="50" rx="12" className="lp2-bar-held" />
            </g>
            {SEGS.map((s) => (
              <g key={s.code} className={`lp2-share lp2-share-${s.end}`} style={{ "--x": `var(--s${s.k})` } as CSSProperties}>
                <rect x={s.x + 2} y="432" width={s.w - 4} height="46" rx="10" />
                <text x={s.x + s.w / 2} y="460" textAnchor="middle" className="lp2-share-code">{s.code}</text>
                <text x={s.x + s.w / 2} y="504" textAnchor="middle" className="lp2-share-label">{END_LABEL[s.end]}</text>
                <text x={s.x + s.w / 2} y="522" textAnchor="middle" className="lp2-t-mono lp2-share-amt">{usd(s.cents)}</text>
              </g>
            ))}
            <g className="lp2-sr-in" style={{ "--x": "var(--s4)" } as CSSProperties}>
              <text x="300" y="566" textAnchor="middle" className="lp2-t-dim lp2-t-small">Released by partial capture · M04 frozen alone · M06 voided back to the client</text>
            </g>
          </svg>
        </div>
      </div>
    </section>
  );
}
