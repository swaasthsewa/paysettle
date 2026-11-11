/**
 * F3 · the landing page at /. The hero's settlement field, the scroll-driven reveal "from a sentence to a settlement", the contract compiler and
 * the problem, then the motion scenes: built on PayPal (pinned), trust, AI, agents, disputes, how it works, what it is and
 * is not, the blog, and the close with the live waitlist count. Facts come from the database.
 */
import { Compiler, Problem } from "@/components/site/landing/chapters";
import { AgentsScene, AiScene, DisputesScene, HowScene, LimitsScene, TrustScene } from "@/components/site/landing/scenes";
import { PaypalScene } from "@/components/site/landing/PaypalScene";
import { BlogStrip } from "@/components/site/landing/BlogStrip";
import { Closing } from "@/components/site/landing/closing";
import { landingFacts } from "@/components/site/landing/facts";
import { Hero } from "@/components/site/landing/hero";
import { Motion } from "@/components/site/landing/motion";
import { SettleReveal } from "@/components/site/landing/SettleReveal";
import "@/styles/landing.css";
import "@/styles/landing-scenes.css";
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
      {/* pinned with position: sticky, the centrepiece */}
      <PaypalScene />
      <TrustScene facts={facts} />
      <AiScene />
      <AgentsScene />
      <DisputesScene />
      <HowScene />
      <LimitsScene />
      <BlogStrip />
      <Closing waitlist={facts.waitlist} />
    </Motion>
  );
}
