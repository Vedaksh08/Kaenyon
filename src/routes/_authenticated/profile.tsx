import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  MapPin,
  BookOpen,
  Users,
  Trophy,
  LogOut,
  Award,
  Briefcase,
  Plus,
  Trash2,
  Pencil,
  Save,
  X,
  GraduationCap,
  Mail,
  Upload,
  FileText,
  ImageIcon,
} from "lucide-react";
import { usePlan } from "@/lib/plan-context";
import { fetchMyStats, type MyStats } from "@/lib/social";

import { BottomNav } from "@/components/bottom-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Your Profile — StudyAll" },
      {
        name: "description",
        content: "Manage your StudyAll profile, certificates, experience and study stats.",
      },
      { property: "og:title", content: "Your Profile — StudyAll" },
      {
        property: "og:description",
        content: "Manage your StudyAll profile, certificates, experience and study stats.",
      },
    ],
  }),
  component: Profile,
});

interface Certificate {
  id: string;
  file: {
    name: string;
    type: string; // image/* or application/pdf
    dataUrl: string;
  };
}

interface Experience {
  id: string;
  role: string;
  company: string;
  type: "Internship" | "Job" | "Project" | "Volunteer";
  start: string;
  end: string; // or "Present"
  description: string;
}

const CERT_KEY = "studyall.certificates";
const EXP_KEY = "studyall.experience";

function loadList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function Profile() {
  const { profile, setProfile } = usePlan();
  const [stats, setStats] = useState<MyStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) return;
      try {
        const s = await fetchMyStats(uid);
        if (!cancelled) setStats(s);
      } catch {
        /* stats are non-critical */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: profile?.name ?? "",
    college: profile?.college ?? "",
    course: profile?.course ?? "",
    year: profile?.year ?? "",
    email: profile?.email ?? "",
  });

  useEffect(() => {
    setDraft({
      name: profile?.name ?? "",
      college: profile?.college ?? "",
      course: profile?.course ?? "",
      year: profile?.year ?? "",
      email: profile?.email ?? "",
    });
  }, [profile]);

  const [certs, setCerts] = useState<Certificate[]>([]);
  const [exps, setExps] = useState<Experience[]>([]);

  useEffect(() => {
    setCerts(loadList<Certificate>(CERT_KEY));
    setExps(loadList<Experience>(EXP_KEY));
  }, []);

  const saveCerts = (next: Certificate[]) => {
    setCerts(next);
    try {
      localStorage.setItem(CERT_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable (private mode) — keep the in-memory state.
    }
  };
  const saveExps = (next: Experience[]) => {
    setExps(next);
    try {
      localStorage.setItem(EXP_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable (private mode) — keep the in-memory state.
    }
  };

  const saveProfile = () => {
    if (!draft.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setProfile({
      name: draft.name.trim(),
      college: draft.college.trim(),
      course: draft.course.trim(),
      year: draft.year.trim(),
      email: draft.email.trim(),
    });
    setEditing(false);
    toast.success("Profile updated");
  };

  const displayName = profile?.name?.trim() || "Guest";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-5 pt-10 text-center">
        <div className="relative mx-auto h-24 w-24">
          {profile?.avatar ? (
            <img
              src={profile.avatar}
              alt={displayName}
              className="h-24 w-24 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary text-3xl font-bold text-primary-foreground">
              {initial}
            </div>
          )}
          <label
            className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-teal-500 text-white shadow-card hover:bg-teal-600"
            title="Upload profile photo"
            aria-label="Upload profile photo"
          >
            <Upload className="h-4 w-4" />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (!f.type.startsWith("image/")) {
                  toast.error("Please choose an image");
                  return;
                }
                if (f.size > 3 * 1024 * 1024) {
                  toast.error("Image too large (max 3 MB)");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  setProfile({
                    name: profile?.name ?? "",
                    college: profile?.college ?? "",
                    course: profile?.course ?? "",
                    year: profile?.year ?? "",
                    email: profile?.email ?? "",
                    avatar: String(reader.result),
                  });
                  toast.success("Profile photo updated");
                };
                reader.readAsDataURL(f);
              }}
            />
          </label>
          {profile?.avatar && (
            <button
              onClick={() => {
                setProfile({
                  name: profile?.name ?? "",
                  college: profile?.college ?? "",
                  course: profile?.course ?? "",
                  year: profile?.year ?? "",
                  email: profile?.email ?? "",
                  avatar: undefined,
                });
                toast.success("Photo removed");
              }}
              className="absolute -top-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-card text-danger shadow-card hover:bg-secondary"
              aria-label="Remove photo"
              title="Remove photo"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <h1 className="mt-3 text-xl font-extrabold text-foreground">{displayName}</h1>
        {profile?.college && (
          <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" /> {profile.college}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => setEditing((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full bg-card px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-foreground shadow-card"
          >
            {editing ? <X className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
            {editing ? "Cancel" : "Edit"}
          </button>
        </div>
      </header>

      {editing && (
        <section className="mt-5 mx-5 rounded-2xl bg-card p-4 shadow-card">
          <h2 className="text-sm font-bold text-foreground">Edit profile</h2>
          <div className="mt-3 grid gap-3">
            <Field label="Full name">
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Your name"
              />
            </Field>
            <Field label="College">
              <Input
                value={draft.college}
                onChange={(e) => setDraft({ ...draft, college: e.target.value })}
                placeholder="e.g. IIT Bombay"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Course">
                <Input
                  value={draft.course}
                  onChange={(e) => setDraft({ ...draft, course: e.target.value })}
                  placeholder="e.g. CSE"
                />
              </Field>
              <Field label="Year">
                <Input
                  value={draft.year}
                  onChange={(e) => setDraft({ ...draft, year: e.target.value })}
                  placeholder="e.g. 2nd"
                />
              </Field>
            </div>
            <Field label="Email">
              <Input
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="you@college.edu"
              />
            </Field>
          </div>
          <Button onClick={saveProfile} className="mt-4 w-full gap-2">
            <Save className="h-4 w-4" /> Save profile
          </Button>
        </section>
      )}

      {!editing && (profile?.course || profile?.email) && (
        <section className="mt-4 mx-5 rounded-2xl bg-card p-4 shadow-card text-sm">
          {profile?.course && (
            <Row
              icon={GraduationCap}
              label={`${profile.course}${profile.year ? ` · ${profile.year} year` : ""}`}
            />
          )}
          {profile?.email && <Row icon={Mail} label={profile.email} />}
        </section>
      )}

      <section className="mt-4 grid grid-cols-2 gap-3 px-5">
        <Stat icon={BookOpen} label="DOUBTS ASKED" value={String(stats?.doubts_asked ?? 0)} />
        <Stat icon={Users} label="FRIENDS" value={String(stats?.friends ?? 0)} />
      </section>

      <div className="mt-4 mx-5 rounded-2xl bg-primary p-4 text-primary-foreground shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">
              Global Rank
            </div>
            <div className="text-2xl font-extrabold">
              #{stats ? stats.rank.toLocaleString() : "—"}
            </div>
            <div className="mt-1 text-[11px] opacity-80">
              {stats?.answers_given ?? 0} solved ·{" "}
              {stats ? Number(stats.avg_rating).toFixed(1) : "0.0"} / 10 avg rating
            </div>
          </div>

          <Trophy className="h-8 w-8" />
        </div>
      </div>

      <CertificatesSection certs={certs} onSave={saveCerts} />
      <ExperienceSection exps={exps} onSave={saveExps} />

      <section className="mt-5 px-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Badges</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { c: "bg-orange-500", t: "Fast Responder" },
            { c: "bg-pro", t: "Math Whiz" },
            { c: "bg-success", t: "Top Reviewer" },
          ].map((b) => (
            <div
              key={b.t}
              className={`flex items-center gap-1 rounded-full ${b.c} px-3 py-1 text-[11px] font-semibold text-white`}
            >
              ● {b.t}
            </div>
          ))}
        </div>
      </section>

      <button
        onClick={async () => {
          const { supabase } = await import("@/integrations/supabase/client");
          await supabase.auth.signOut();
          window.location.href = "/";
        }}
        className="mt-4 mx-5 flex w-[calc(100%-2.5rem)] items-center justify-center gap-2 rounded-lg bg-card py-3 text-sm font-semibold text-danger shadow-card"
      >
        <LogOut className="h-4 w-4" /> Log Out
      </button>

      <BottomNav />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-semibold text-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Row({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-foreground">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span>{label}</span>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-card">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-1 text-2xl font-extrabold text-foreground">{value}</div>
    </div>
  );
}

function CertificatesSection({
  certs,
  onSave,
}: {
  certs: Certificate[];
  onSave: (n: Certificate[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<Certificate["file"] | undefined>(undefined);

  const onPickFile = (f: File | undefined) => {
    if (!f) return;
    const ok = f.type.startsWith("image/") || f.type === "application/pdf";
    if (!ok) {
      toast.error("Only photos or PDF files are allowed");
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      toast.error("File too large (max 5 MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setFile({ name: f.name, type: f.type, dataUrl: String(reader.result) });
    };
    reader.readAsDataURL(f);
  };

  const add = () => {
    if (!file) {
      toast.error("Please upload a file");
      return;
    }
    onSave([{ id: crypto.randomUUID(), file }, ...certs]);
    setFile(undefined);
    setOpen(false);
    toast.success("Certificate added");
  };

  return (
    <section className="mt-6 mx-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <Award className="h-4 w-4 text-pro" /> Certificates
        </h2>
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full bg-card px-3 py-1 text-[11px] font-bold text-foreground shadow-card"
        >
          {open ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />} {open ? "Close" : "Add"}
        </button>
      </div>

      {open && (
        <div className="mt-3 rounded-2xl bg-card p-4 shadow-card grid gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold text-foreground">
              Upload (JPG or PDF only)
            </Label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background px-3 py-3 text-xs font-semibold text-foreground hover:bg-accent">
              <Upload className="h-4 w-4" />
              {file ? "Replace file" : "Choose photo or PDF"}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => onPickFile(e.target.files?.[0])}
              />
            </label>
            {file && (
              <div className="mt-2 flex items-center justify-between rounded-md bg-secondary px-2 py-1.5 text-xs">
                <span className="flex items-center gap-1.5 truncate text-foreground">
                  {file.type === "application/pdf" ? (
                    <FileText className="h-3.5 w-3.5" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5" />
                  )}
                  <span className="truncate">{file.name}</span>
                </span>
                <button
                  onClick={() => setFile(undefined)}
                  className="text-muted-foreground hover:text-danger"
                  aria-label="Remove file"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          <Button onClick={add} className="gap-2">
            <Save className="h-4 w-4" /> Save certificate
          </Button>
        </div>
      )}

      <div className="mt-3 grid gap-2">
        {certs.length === 0 && !open && (
          <div className="rounded-2xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No certificates yet. Add your first one.
          </div>
        )}
        {certs.map((c) => (
          <div
            key={c.id}
            className="flex items-start justify-between gap-3 rounded-2xl bg-card p-3 shadow-card"
          >
            <div className="flex items-start gap-3">
              {c.file.type.startsWith("image/") ? (
                <img
                  src={c.file.dataUrl}
                  alt={c.file.name}
                  className="h-12 w-12 rounded-lg object-cover"
                />
              ) : (
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-pro/10 text-pro">
                  <FileText className="h-4 w-4" />
                </div>
              )}
              <div>
                <div className="text-sm font-bold text-foreground">{c.file.name}</div>
                <a
                  href={c.file.dataUrl}
                  target="_blank"
                  rel="noreferrer"
                  download={c.file.name}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                >
                  {c.file.type === "application/pdf" ? (
                    <FileText className="h-3 w-3" />
                  ) : (
                    <ImageIcon className="h-3 w-3" />
                  )}
                  View {c.file.type === "application/pdf" ? "PDF" : "photo"}
                </a>
              </div>
            </div>
            <button
              onClick={() => onSave(certs.filter((x) => x.id !== c.id))}
              className="text-muted-foreground hover:text-danger"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function ExperienceSection({
  exps,
  onSave,
}: {
  exps: Experience[];
  onSave: (n: Experience[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    role: string;
    company: string;
    type: Experience["type"];
    start: string;
    end: string;
    description: string;
  }>({
    role: "",
    company: "",
    type: "Internship",
    start: "",
    end: "",
    description: "",
  });

  const add = () => {
    if (!form.role.trim() || !form.company.trim()) {
      toast.error("Role and company are required");
      return;
    }
    onSave([
      {
        id: crypto.randomUUID(),
        role: form.role.trim(),
        company: form.company.trim(),
        type: form.type,
        start: form.start.trim(),
        end: form.end.trim() || "Present",
        description: form.description.trim(),
      },
      ...exps,
    ]);
    setForm({ role: "", company: "", type: "Internship", start: "", end: "", description: "" });
    setOpen(false);
    toast.success("Experience added");
  };

  return (
    <section className="mt-6 mx-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <Briefcase className="h-4 w-4 text-primary" /> Internships & Experience
        </h2>
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full bg-card px-3 py-1 text-[11px] font-bold text-foreground shadow-card"
        >
          {open ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />} {open ? "Close" : "Add"}
        </button>
      </div>

      {open && (
        <div className="mt-3 rounded-2xl bg-card p-4 shadow-card grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role">
              <Input
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                placeholder="e.g. SDE Intern"
              />
            </Field>
            <Field label="Company">
              <Input
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                placeholder="e.g. Razorpay"
              />
            </Field>
          </div>
          <Field label="Type">
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as Experience["type"] })}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="Internship">Internship</option>
              <option value="Job">Job</option>
              <option value="Project">Project</option>
              <option value="Volunteer">Volunteer</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <Input
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
                placeholder="e.g. May 2025"
              />
            </Field>
            <Field label="End">
              <Input
                value={form.end}
                onChange={(e) => setForm({ ...form, end: e.target.value })}
                placeholder="Present"
              />
            </Field>
          </div>
          <Field label="Description">
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What did you work on?"
              className="text-foreground placeholder:text-muted-foreground"
              rows={3}
            />
          </Field>
          <Button onClick={add} className="gap-2">
            <Save className="h-4 w-4" /> Save experience
          </Button>
        </div>
      )}

      <div className="mt-3 grid gap-2">
        {exps.length === 0 && !open && (
          <div className="rounded-2xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No experience yet. Add internships, jobs, or projects.
          </div>
        )}
        {exps.map((e) => (
          <div
            key={e.id}
            className="flex items-start justify-between gap-3 rounded-2xl bg-card p-3 shadow-card"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Briefcase className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-bold text-foreground">
                  {e.role} <span className="text-muted-foreground">· {e.company}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  <span className="rounded bg-secondary px-1.5 py-0.5 font-semibold uppercase tracking-wider">
                    {e.type}
                  </span>
                  {(e.start || e.end) && (
                    <span className="ml-2">
                      {e.start}
                      {e.start && e.end ? " — " : ""}
                      {e.end}
                    </span>
                  )}
                </div>
                {e.description && (
                  <p className="mt-1 text-xs text-foreground/80 whitespace-pre-wrap">
                    {e.description}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => onSave(exps.filter((x) => x.id !== e.id))}
              className="text-muted-foreground hover:text-danger"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
