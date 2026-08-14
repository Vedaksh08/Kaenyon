import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, LogOut, Moon, Pencil, Sun, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlan } from "@/lib/plan-context";
import { BottomNav } from "@/components/bottom-nav";
import { KaenyonMark } from "@/components/brand";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Profile — Kaenyon" },
      { name: "description", content: "Manage your Kaenyon account, profile and appearance." },
    ],
  }),
  component: Settings,
});

const YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];

function Settings() {
  const nav = useNavigate();
  const { profile, setProfile, theme, setTheme } = usePlan();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dob, setDob] = useState("");
  const [draft, setDraft] = useState({
    name: "",
    college: "",
    course: "",
    year: YEARS[0],
    dob: "",
  });

  // `dob` is not carried on the shared profile context, so read it here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const { data: prof } = await supabase
        .from("profiles")
        .select("dob")
        .eq("id", data.user.id)
        .maybeSingle();
      if (!cancelled && prof?.dob) setDob(prof.dob);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setDraft({
      name: profile?.name ?? "",
      college: profile?.college ?? "",
      course: profile?.course ?? "",
      year: profile?.year || YEARS[0],
      dob,
    });
  }, [profile, dob]);

  const save = async () => {
    if (!draft.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const { error } = await supabase
        .from("profiles")
        .update({ dob: draft.dob || null })
        .eq("id", data.user.id);
      if (error) {
        setSaving(false);
        toast.error(error.message);
        return;
      }
      setDob(draft.dob);
    }
    // setProfile persists name/college/course/year through the shared context.
    setProfile({
      name: draft.name.trim(),
      college: draft.college.trim(),
      course: draft.course.trim(),
      year: draft.year,
      email: profile?.email ?? "",
      avatar: profile?.avatar,
    });
    setSaving(false);
    setEditing(false);
    toast.success("Profile updated");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    nav({ to: "/login", replace: true });
  };

  const displayName = profile?.name?.trim() || "Student";

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-5 py-4">
          <KaenyonMark className="h-7 w-7" />
          <h1 className="text-lg font-bold">Profile</h1>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-5 py-5">
        {/* Identity card */}
        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="h-24 bg-gradient-to-br from-primary to-primary/60" />
          <div className="px-6 pb-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-end gap-4">
                <div className="-mt-12 flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-4 border-card bg-primary text-3xl font-bold text-primary-foreground">
                  {displayName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 pb-1">
                  <div className="truncate text-xl font-bold">{displayName}</div>
                  <div className="truncate text-sm text-muted-foreground">{profile?.email}</div>
                </div>
              </div>
              {(profile?.course || profile?.year || profile?.college) && (
                <div className="flex flex-wrap gap-1.5 pb-1">
                  {profile?.college && <Chip>{profile.college}</Chip>}
                  {profile?.course && <Chip>{profile.course}</Chip>}
                  {profile?.year && <Chip>{profile.year}</Chip>}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Profile details */}
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Profile</h2>
            {editing ? (
              <div className="flex gap-1">
                <button
                  onClick={save}
                  disabled={saving}
                  aria-label="Save profile"
                  className="rounded-md p-1.5 text-success hover:bg-secondary disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setEditing(false)}
                  aria-label="Cancel editing"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-secondary"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            )}
          </div>

          <dl className="mt-4 space-y-3">
            <Row label="Full name">
              {editing ? (
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className={inputClass}
                />
              ) : (
                displayName
              )}
            </Row>
            <Row label="Date of birth">
              {editing ? (
                <input
                  type="date"
                  value={draft.dob}
                  onChange={(e) => setDraft({ ...draft, dob: e.target.value })}
                  className={inputClass}
                />
              ) : (
                dob || "—"
              )}
            </Row>
            <Row label="College">
              {editing ? (
                <input
                  value={draft.college}
                  onChange={(e) => setDraft({ ...draft, college: e.target.value })}
                  className={inputClass}
                />
              ) : (
                profile?.college || "—"
              )}
            </Row>
            <Row label="Course">
              {editing ? (
                <input
                  value={draft.course}
                  onChange={(e) => setDraft({ ...draft, course: e.target.value })}
                  className={inputClass}
                />
              ) : (
                profile?.course || "—"
              )}
            </Row>
            <Row label="Year">
              {editing ? (
                <select
                  value={draft.year}
                  onChange={(e) => setDraft({ ...draft, year: e.target.value })}
                  className={inputClass}
                >
                  {YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              ) : (
                profile?.year || "—"
              )}
            </Row>
          </dl>
        </section>

        {/* Appearance */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-bold">Appearance</h2>
          <div className="mt-3 flex gap-2 sm:max-w-xs">
            <ThemeButton
              active={theme === "light"}
              onClick={() => setTheme("light")}
              icon={<Sun className="h-4 w-4" />}
              label="Light"
            />
            <ThemeButton
              active={theme === "dark"}
              onClick={() => setTheme("dark")}
              icon={<Moon className="h-4 w-4" />}
              label="Dark"
            />
          </div>
        </section>

        <button
          onClick={signOut}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-danger/30 bg-card py-3.5 text-sm font-semibold text-danger transition hover:bg-danger/10 sm:w-auto sm:px-6"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>

      <BottomNav />
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25";

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

function ThemeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-semibold transition ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:bg-secondary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
