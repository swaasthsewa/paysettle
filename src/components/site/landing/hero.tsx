/**
 * F3 · the landing hero. Two strands, teal for the client and amber for the provider (the colours of the brand mark),
 * swing through the giant type in opposite directions, a little less each time, until they meet and leave as one
 * white line: a settled agreement. Drawn in a box centred on the heading (1440 x 640 units). Every word and picture is PaySettle's.
 * The entrance is plain CSS, so it plays before any script has loaded and stays still under reduced motion.
 */
import { JudgeTour } from "@/components/tour/JudgeTour";
import Link from "next/link";
import { site } from "@/copy/site";

export const TEAL = "#0d9488";
export const AMBER = "#f59e0b";

/** Where the two strands cross. The first two crossings lie off the left edge so a wide screen still sees them come in. */
const CROSS = [-640, -350, -60, 230, 490, 720, 910, 1060, 1170, 1260];
const MID = 320;
const SWING = 0.62;
const n = (v: number) => Math.round(v * 10) / 10;

function strand(startsUp: boolean): string {
  let d = `M${CROSS[0]} ${MID}`;
  let up = startsUp;
  for (let i = 0; i < CROSS.length - 1; i++) {
    const a = CROSS[i], b = CROSS[i + 1], w = b - a;
    const peak = (up ? -1 : 1) * SWING * w * (4 / 3);
    const last = i === CROSS.length - 2;
    d += ` C${n(a + w / 3)} ${n(MID + peak)} ${n(b - w / 3)} ${n(MID + (last ? 0 : peak))} ${b} ${MID}`;
    up = !up;
  }
  return d;
}

const CLIENT_PATH = strand(true);
const PROVIDER_PATH = strand(false);
const END = CROSS[CROSS.length - 1];
/** The joined line: on a wide screen it curls down past the buttons; on a phone it leaves to the side. */
const ONE_WIDE = `M${END} ${MID} C${END + 70} ${MID} ${END + 112} ${MID + 72} ${END + 112} ${MID + 160} S${END + 70} ${MID + 440} ${END + 128} ${MID + 780}`;
const ONE_NARROW = `M${END} ${MID} H1560`;

/** In front of the type the two strands take turns, one swing each: that is what makes them weave. */
function Turns({ id, odd }: { id: string; odd: boolean }) {
  return (
    <clipPath id={id}>
      {CROSS.slice(0, -1).map((a, i) => (i % 2 === (odd ? 1 : 0) ? <rect key={a} x={a} y={-200} width={CROSS[i + 1] - a} height={1040} /> : null))}
    </clipPath>
  );
}

/** One line of the heading: the white ink, and behind it a teal and an amber copy that start apart and fuse on scroll. */
function Row({ text, split }: { text: string; split?: boolean }) {
  return (
    <span className="lp-h1-row" data-split={split ? "" : undefined}>
      <span className="lp-ghost lp-ghost-a" aria-hidden="true">{text}</span>
      <span className="lp-ghost lp-ghost-b" aria-hidden="true">{text}</span>
      <span className="lp-h1-ink">{text}</span>
    </span>
  );
}

export function Hero() {
  const t = site.landing.hero;
  return (
    <section className="lp-hero" data-scene="hero" aria-labelledby="lp-hero-h">
      <div className="lp-hero-stage">
        <div className="lp-hero-in">
          <div className="lp-h1-wrap">
            <svg className="lp-thread lp-thread-back" viewBox="0 0 1440 640" role="img" aria-label={t.art}>
              <path className="lp-draw" pathLength={1} d={CLIENT_PATH} stroke={TEAL} />
              <path className="lp-draw" pathLength={1} d={PROVIDER_PATH} stroke={AMBER} />
              <path className="lp-draw lp-draw-late lp-wide" pathLength={1} d={ONE_WIDE} stroke="#ffffff" />
              <path className="lp-draw lp-draw-late lp-narrow" pathLength={1} d={ONE_NARROW} stroke="#ffffff" />
              <circle className="lp-join" cx={END} cy={MID} r="9" fill="#ffffff" />
            </svg>
            <h1 className="lp-h1" id="lp-hero-h">
              <Row text={t.line1} split />{" "}
              <Row text={t.line2} />
            </h1>
            <svg className="lp-thread lp-thread-front" viewBox="0 0 1440 640" aria-hidden="true" focusable="false">
              <defs><Turns id="lp-turn-a" odd={false} /><Turns id="lp-turn-b" odd /></defs>
              <g clipPath="url(#lp-turn-a)"><path className="lp-draw" pathLength={1} d={CLIENT_PATH} stroke={TEAL} /></g>
              <g clipPath="url(#lp-turn-b)"><path className="lp-draw" pathLength={1} d={PROVIDER_PATH} stroke={AMBER} /></g>
            </svg>
            <div className="lp-chips" aria-hidden="true">
              <span className="lp-chip-pos" style={{ left: "1.5%", top: "4%" }} data-chip><span className="lp-chip"><i style={{ background: TEAL }} />{t.chips.client}</span></span>
              <span className="lp-chip-pos" style={{ left: "1.5%", top: "86%" }} data-chip><span className="lp-chip"><i style={{ background: AMBER }} />{t.chips.provider}</span></span>
              <span className="lp-chip-pos lp-chip-end" style={{ right: "1.5%", top: "32%" }} data-chip><span className="lp-chip"><i style={{ background: "#ffffff" }} />{t.chips.both}</span></span>
            </div>
          </div>
          <p className="lp-hero-lead">{t.lead}</p>
          <div className="lp-ctas">
            <Link className="btn btn-g lp-btn" href="/login">{t.demo}</Link>
            <Link className="btn lp-btn lp-btn-line" href="/playground">{t.judge}</Link>
            <JudgeTour className="btn lp-btn lp-btn-line" />
            <Link className="btn lp-btn lp-btn-line" href="/waitlist">{t.waitlist}</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
