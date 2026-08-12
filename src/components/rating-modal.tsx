import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const LABELS: Record<number, string> = {
  1: "1 — Not helpful at all",
  2: "2 — Barely helped",
  3: "3 — A little helpful",
  4: "4 — Could be better",
  5: "5 — It was okay",
  6: "6 — Pretty good",
  7: "7 — Good session",
  8: "8 — Great session",
  9: "9 — Excellent",
  10: "10 — Absolutely perfect!",
};

export function RatingModal({
  open,
  onClose,
  rateeId,
  classroomId,
}: {
  open: boolean;
  onClose: () => void;
  rateeId?: string | null;
  classroomId?: string | null;
}) {
  const [solved, setSolved] = useState<"yes" | "partial" | "no" | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const color = (n: number, selected: boolean) => {
    if (!selected) return "text-foreground border-border hover:bg-secondary";
    if (n <= 4) return "bg-danger text-white border-danger";
    if (n <= 7) return "bg-warning text-white border-warning";
    return "bg-success text-white border-success";
  };

  const submit = async () => {
    if (!score) {
      toast.error("Pick a score from 1 to 10");
      return;
    }
    setSaving(true);
    try {
      const { data } = await supabase.auth.getUser();
      const me = data.user?.id;
      if (!me) throw new Error("Sign in required");
      const { error } = await supabase.from("session_ratings").insert({
        rater_id: me,
        ratee_id: rateeId && rateeId !== me ? rateeId : null,
        classroom_id: classroomId ?? null,
        score,
        solved,
        comment: text.trim() || null,
      });
      if (error) throw error;
      toast.success("Rating submitted. Thanks!");
      setScore(null);
      setSolved(null);
      setText("");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save rating");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-lg rounded-2xl bg-card p-6 shadow-elevated">
        <h3 className="text-center text-lg font-bold">Was your doubt solved?</h3>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { v: "yes", label: "✅ Yes" },
            { v: "partial", label: "🔶 Partially" },
            { v: "no", label: "❌ No" },
          ].map((o) => (
            <button
              key={o.v}
              onClick={() => setSolved(o.v as never)}
              className={`rounded-lg border py-2 text-sm font-medium ${
                solved === o.v ? "border-primary bg-primary/10 text-primary" : "border-border"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="mt-6 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Rate your session
        </div>
        <div className="mt-3 flex justify-between gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
            const selected = score === n;
            return (
              <button
                key={n}
                onClick={() => setScore(n)}
                className={`h-10 w-9 rounded-md border text-sm font-bold ${color(n, selected)}`}
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="mt-3 min-h-5 text-center text-sm font-medium text-foreground">
          {score ? LABELS[score] : " "}
        </div>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tell us why (optional)
        </label>
        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What did they explain well? What could be better?"
          className="mt-1 w-full rounded-lg border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground"
        />
        <button
          onClick={submit}
          disabled={saving}
          className="mt-4 w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {saving ? "Submitting…" : "Submit Rating"}
        </button>
      </div>
    </div>
  );
}
