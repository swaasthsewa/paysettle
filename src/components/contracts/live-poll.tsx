"use client";
/**
 * F2.03 live negotiation room: polls the workspace's revision stamp every 4 s and refreshes the server-rendered page
 * when the other party has changed or signed something. Pauses while the tab is hidden.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function LivePoll({ id, stamp }: { id: string; stamp: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  useEffect(() => {
    let alive = true;
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/contracts/${encodeURIComponent(id)}/rev`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { stamp?: string; revision?: number };
        if (alive && j.stamp && j.stamp !== stamp) { setNote(`Updated to revision ${j.revision}.`); router.refresh(); }
      } catch { /* offline: try again on the next tick */ }
    }, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [id, stamp, router]);
  return <span className="live" aria-live="polite">{note || "Live — changes from the other party appear here"}</span>;
}
