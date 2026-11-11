/**
 * F3 · the landing hero, on the night surface. The copy is server-rendered and readable from the first paint; behind it
 * the settlement field (HeroFlow → settle-field.ts) shows the product's loop: the client's money waits in a PayPal hold,
 * passes one milestone's evidence check and reaches the provider, while a failed check freezes only that share.
 * Every word and picture is PaySettle's.
 */
import { JudgeTour } from "@/components/tour/JudgeTour";
import Link from "next/link";
import { site } from "@/copy/site";
import { HeroFlow } from "./HeroFlow";

export const TEAL = "#0d9488";
export const AMBER = "#f59e0b";

/** Marks one word of a heading line in the accent gradient. */
function Accent({ text, word }: { text: string; word: string }) {
  const i = text.indexOf(word);
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<em className="lp2-accent">{word}</em>{text.slice(i + word.length)}</>;
}

export function Hero() {
  const t = site.landing.hero;
  return (
    <section className="lp2-hero" data-scene="hero" aria-labelledby="lp-hero-h">
      <HeroFlow />
      <div className="lp2-hero-glow" aria-hidden="true" />
      <div className="lp-wrap lp2-hero-in">
        <p className="lp2-badge"><span className="lp2-badge-dot" aria-hidden="true" />{t.badge}</p>
        <h1 className="lp2-h1" id="lp-hero-h">
          <span><Accent text={t.line1} word="done" /></span>
          <span><Accent text={t.line2} word="paid" /></span>
        </h1>
        <p className="lp2-lead">{t.lead}</p>
        <div className="lp2-ctas">
          <Link className="btn lp2-btn lp2-btn-main" href="/login">{t.demo}</Link>
          <Link className="btn lp2-btn" href="/playground">{t.judge}</Link>
          <JudgeTour className="btn lp2-btn" />
          <Link className="btn lp2-btn lp2-btn-quiet" href="/waitlist">{t.waitlist}</Link>
        </div>
        <ul className="lp2-legend" aria-label={t.art}>
          <li><i style={{ background: "#2dd4bf" }} aria-hidden="true" />{t.chips.client}</li>
          <li><i className="lp2-diamond" aria-hidden="true" />{t.chips.both}</li>
          <li><i style={{ background: "#f5a524" }} aria-hidden="true" />{t.chips.provider}</li>
        </ul>
      </div>
    </section>
  );
}
