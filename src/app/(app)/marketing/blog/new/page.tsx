/** P3 blog studio — start a post: by hand, or from a brief through the AI gateway (outline when AI is off). */
import Link from "next/link";
import { redirect } from "next/navigation";
import { can } from "@/lib/rbac";
import { homeFor, requireViewer } from "@/lib/session";
import { aiStatus } from "@/server/ai";
import { flagOn } from "@/server/control/flags";
import { Head } from "@/components/console/parts";
import { BriefForm, ManualForm } from "@/components/blog-studio/NewPostForms";
import "@/styles/blog-studio.css";

export const metadata = { title: "New blog post" };

export default async function Page() {
  const v = await requireViewer();
  if (!can(v.role, "blog.write")) redirect(homeFor(v.role));
  const [st, on] = await Promise.all([aiStatus().catch(() => ({ available: false, reason: "AI status could not be read", model: undefined })), flagOn("ai.enabled").catch(() => false)]);
  const ai = on ? { available: st.available, reason: st.reason, model: st.model } : { available: false, reason: "switched off by an admin on the Switchboard" };
  return (
    <>
      <Head title="New blog post" sub="Every new post starts as a private draft. Publishing is a separate step that runs the claim guard.">
        <Link className="btn btn-sm btn-gh" href="/marketing/blog">Back to all posts</Link>
      </Head>
      <div className="bs-new">
        <section className="c"><ManualForm /></section>
        <section className="c" id="brief"><BriefForm aiStatus={ai} /></section>
      </div>
    </>
  );
}
