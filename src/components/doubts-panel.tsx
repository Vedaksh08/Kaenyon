import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { HandHelping, MessageSquare, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PathwaayMark } from "@/components/brand";

export interface Doubt {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
}

/**
 * The doubts list for one classroom.
 *
 * This is the point of Pathwaay: the classroom is silent, so a student who is
 * stuck types the question here and whoever knows the answer offers to help.
 * Lives in its own component because both the classroom and the older
 * peer-to-peer room need it.
 */
export function DoubtsPanel({
  classroomId,
  myUserId,
  onOfferHelp,
}: {
  classroomId: string;
  myUserId: string | null;
  /** Called after an offer is recorded, so the caller can start a session. */
  onOfferHelp?: (doubt: Doubt) => void;
}) {
  const [doubts, setDoubts] = useState<Doubt[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    /** Resolve names through the RPC: RLS hides other people's profile rows,
     * so a direct select returns nothing and everyone shows as "Student". */
    const withNames = async (rows: Array<{ id: string; body: string; author_id: string }>) => {
      const ids = [...new Set(rows.map((r) => r.author_id))];
      const names = new Map<string, string>();
      if (ids.length) {
        const { data } = await supabase.rpc("get_public_profiles", { _user_ids: ids });
        (data ?? []).forEach((p) => {
          if (p.name?.trim()) names.set(p.id, p.name.trim());
        });
      }
      return rows.map((r) => ({
        id: r.id,
        body: r.body,
        authorId: r.author_id,
        authorName: names.get(r.author_id) ?? "Student",
      }));
    };

    const load = async () => {
      const { data: rows } = await supabase
        .from("doubts")
        .select("id, body, author_id")
        .eq("classroom_id", classroomId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled || !rows) return;
      setDoubts(await withNames(rows));
    };

    void load();

    const channel = supabase
      .channel(`doubts:${classroomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "doubts",
          filter: `classroom_id=eq.${classroomId}`,
        },
        async (payload) => {
          const row = payload.new as { id: string; body: string; author_id: string };
          const [withName] = await withNames([row]);
          if (cancelled) return;
          setDoubts((prev) => (prev.some((d) => d.id === row.id) ? prev : [withName, ...prev]));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "doubts",
          filter: `classroom_id=eq.${classroomId}`,
        },
        (payload) => {
          const old = payload.old as { id: string };
          setDoubts((prev) => prev.filter((d) => d.id !== old.id));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [classroomId]);

  const ask = async () => {
    const text = draft.trim();
    if (!text || !myUserId) return;
    setSending(true);
    setDraft("");
    const { error } = await supabase.from("doubts").insert({
      classroom_id: classroomId,
      author_id: myUserId,
      body: text,
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      setDraft(text);
      return;
    }
    listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const offerHelp = async (doubt: Doubt) => {
    if (!myUserId || doubt.authorId === myUserId) return;
    // An answer row is what the leaderboard counts once the asker confirms it
    // actually helped, so record it before anything else.
    const { data: existing } = await supabase
      .from("answers")
      .select("id")
      .eq("doubt_id", doubt.id)
      .eq("author_id", myUserId)
      .maybeSingle();

    if (!existing) {
      const { error } = await supabase.from("answers").insert({
        doubt_id: doubt.id,
        author_id: myUserId,
        body: "Offered to solve this doubt live in the classroom.",
      });
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    toast.success(`Offer sent to ${doubt.authorName}`);
    onOfferHelp?.(doubt);
  };

  return (
    <aside className="flex w-full shrink-0 flex-col border-t border-white/10 bg-room-card/40 md:w-[340px] md:border-l md:border-t-0">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3.5">
        <MessageSquare className="h-4 w-4 text-primary" />
        <div className="text-sm font-bold">Doubts</div>
        {doubts.length > 0 && (
          <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-bold text-primary">
            {doubts.length}
          </span>
        )}
        <span className="ml-auto text-[11px] text-white/40">This room</span>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
        {doubts.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/15 px-4 py-8 text-center">
            <MessageSquare className="mx-auto h-6 w-6 text-white/30" />
            <p className="mt-2.5 text-xs font-medium text-white/70">No doubts yet</p>
            <p className="mt-1 text-[11px] leading-relaxed text-white/40">
              Stuck on something? Type it below and someone here will help.
            </p>
          </div>
        )}

        {doubts.map((d) => {
          const mine = d.authorId === myUserId;
          return (
            <div key={d.id} className="rounded-lg border border-white/10 bg-room p-3">
              <div className="text-[11px] font-semibold text-primary">
                {mine ? "You" : d.authorName}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-white/90">{d.body}</p>
              {!mine && (
                <button
                  onClick={() => void offerHelp(d)}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition hover:bg-primary/90"
                >
                  <HandHelping className="h-3.5 w-3.5" /> Offer help
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-end gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void ask()}
            placeholder="Ask a question…"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-room px-3.5 py-2.5 text-sm placeholder:text-white/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            onClick={() => void ask()}
            disabled={!draft.trim() || sending}
            aria-label="Post doubt"
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-primary transition hover:bg-primary/90 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 flex items-center gap-1.5 px-0.5 text-[10px] text-white/30">
          <PathwaayMark className="h-3.5 w-3.5" />
          The classroom is silent — type your doubt here
        </p>
      </div>
    </aside>
  );
}
