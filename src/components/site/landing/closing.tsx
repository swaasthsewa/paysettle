/**
 * F3 · the close: the hero's two strands again, this time coming down. They cross, a little less each time, and meet
 * in one white line that ends just above the heading. The live waitlist count sits beside the actions.
 * Drawn in a fixed box of 1440 x 280 units.
 */
import Link from "next/link";
import { site } from "@/copy/site";
import { AMBER, TEAL } from "./hero";

const CROSS = [-90, 24, 104, 164, 208, 236];
const MID = 720;
const SWING = 0.78;
const n = (v: number) => Math.round(v * 10) / 10;

function strand(startsLeft: boolean): string {
  let d = `M${MID} ${CROSS[0]}`;
  let left = startsLeft;
  for (let i = 0; i < CROSS.length - 1; i++) {
    const a = CROSS[i], b = CROSS[i + 1], h = b - a;
    const peak = (left ? -1 : 1) * SWING * h * (4 / 3);
    const last = i === CROSS.length - 2;
    d += ` C${n(MID + peak)} ${n(a + h / 3)} ${n(MID + (last ? 0 : peak))} ${n(b - h / 3)} ${MID} ${b}`;
    left = !left;
  }
  return d;
}
const END = CROSS[CROSS.length - 1];

export function Closing({ waitlist }: { waitlist: number }) {
  const t = site.landing.closing;
  return (
    <section className="lp-close" data-scene="close" aria-labelledby="lp-close-h">
      <div className="lp-close-stage">
        <svg className="lp-close-thread" viewBox="0 0 1440 280" aria-hidden="true" focusable="false">
          <path className="lp-close-line" pathLength={1} d={strand(true)} stroke={TEAL} />
          <path className="lp-close-line" pathLength={1} d={strand(false)} stroke={AMBER} />
          <path className="lp-close-join" pathLength={1} d={`M${MID} ${END}V268`} stroke="#ffffff" />
          <circle className="lp-close-dot" cx={MID} cy="268" r="7" fill="#ffffff" />
        </svg>
        <div className="lp-close-in">
          <h2 id="lp-close-h" data-part>{t.title}</h2>
          <p className="lp-close-lead" data-part>{t.lead}</p>
          <div className="lp-ctas" data-part>
            <Link className="btn btn-g lp-btn" href="/login">{t.demo}</Link>
            <Link className="btn lp-btn lp-btn-line" href="/playground">{t.judge}</Link>
            <Link className="btn lp-btn lp-btn-line" href="/waitlist">{t.waitlist}</Link>
          </div>
          <p className="lp-count" data-part>
            {waitlist > 0
              ? <><b className="tnum">{waitlist.toLocaleString("en-US")}</b> <span>{t.count(waitlist).replace(/^[\d,]+ /, "")}</span></>
              : <span>{t.count(0)}</span>}
          </p>
          <nav className="lp-more" aria-labelledby="lp-more-h" data-part>
            <span id="lp-more-h">{t.more}</span>
            <ul>{t.links.map((l) => <li key={l.href}><Link href={l.href}>{l.label}</Link></li>)}</ul>
          </nav>
        </div>
      </div>
    </section>
  );
}
