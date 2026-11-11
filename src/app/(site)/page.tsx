/**
 * F3 · the landing page at /. The hero's settlement field, the scroll-driven reveal "from a sentence to a settlement", then the chapters: the contract compiler, the problem, how it works, disputes, AI, agents,
 * PayPal, trust, honest limits, and the close with the live waitlist count. Facts come from the database.
 */
import { Ai, Agents, Compiler, Disputes, How, Limits, OnPaypal, Problem, Trust } from "@/components/site/landing/chapters";
import { BlogStrip } from "@/components/site/landing/BlogStrip";
import { Closing } from "@/components/site/landing/closing";
import { landingFacts } from "@/components/site/landing/facts";
import { Hero } from "@/components/site/landing/hero";
import { Motion } from "@/components/site/landing/motion";
import { SettleReveal } from "@/components/site/landing/SettleReveal";
import "@/styles/landing.css";
import { common } from "@/copy/common";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: `${common.product} · Agree what done means. Get paid when it is.` } };

export default async function Home() {
  const facts = await landingFacts();
  return (
    <Motion>
      <Hero />
      {/* outside any data-scene: its stage is position: fixed, so no transformed ancestor may wrap it */}
      <SettleReveal />
      <Compiler />
      <Problem />
      <How facts={facts} />
      <Disputes />
      <Ai />
      <Agents />
      <OnPaypal facts={facts} />
      <Trust facts={facts} />
      <Limits />
      <BlogStrip />
      <Closing waitlist={facts.waitlist} />
    </Motion>
  );
}
