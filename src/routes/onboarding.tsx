import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PathwaayLogo } from "@/components/brand";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Complete your profile — Pathwaay" },
      { name: "description", content: "Tell us about your course so we can match you to peers." },
    ],
  }),
  component: Onboarding,
});

const YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];

interface Course {
  slug: string;
  name: string;
  degree: string;
  duration_years: number;
}

function Onboarding() {
  const nav = useNavigate();
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [form, setForm] = useState({
    name: "",
    dob: "",
    degree: "",
    courseSlug: "",
    college: "",
    year: YEARS[0],
  });

  // The course list drives which subjects a student sees, so load it up front.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("courses")
        .select("slug, name, degree, duration_years")
        .order("degree")
        .order("name");
      if (!cancelled && data) setCourses(data as Course[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Anyone who already finished this should never see it again, and a Google
  // sign-in gives us a name up front worth pre-filling.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) {
        nav({ to: "/login", replace: true });
        return;
      }
      const { data: prof } = await supabase
        .from("profiles")
        .select("name, dob, degree, course_slug, college, year, onboarded_at")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (prof?.onboarded_at) {
        nav({ to: "/home", replace: true });
        return;
      }
      const meta = (user.user_metadata ?? {}) as Record<string, string | undefined>;
      setForm((f) => ({
        ...f,
        name: prof?.name?.trim() || meta.full_name || meta.name || "",
        dob: prof?.dob ?? "",
        degree: prof?.degree ?? "",
        courseSlug: prof?.course_slug ?? "",
        college: prof?.college ?? "",
        year: prof?.year || YEARS[0],
      }));
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [nav]);

  const set =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Please enter your full name");
      return;
    }
    if (!form.degree) {
      toast.error("Please choose your degree");
      return;
    }
    if (!form.courseSlug) {
      toast.error("Please choose your course");
      return;
    }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      setSaving(false);
      nav({ to: "/login", replace: true });
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({
        name: form.name.trim(),
        dob: form.dob || null,
        degree: form.degree,
        course_slug: form.courseSlug,
        // Keep the free-text column in step for anything still reading it.
        course: courses.find((c) => c.slug === form.courseSlug)?.name ?? "",
        college: form.college.trim(),
        year: form.year,
        email: user.email ?? "",
        onboarded_at: new Date().toISOString(),
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    nav({ to: "/home", replace: true });
  };

  // A 3-year B.Sc has no 4th year, so do not offer one.
  const coursesForDegree = courses.filter((c) => c.degree === form.degree);
  const selectedCourse = courses.find((c) => c.slug === form.courseSlug) ?? null;
  const yearOptions = YEARS.slice(0, selectedCourse?.duration_years ?? 4);
  const yearIndex = Math.max(1, yearOptions.indexOf(form.year) + 1);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex justify-center">
          <PathwaayLogo size="lg" tagline />
        </div>

        <div className="mt-8 rounded-2xl border border-border bg-card p-8 shadow-sm">
          <h1 className="text-xl font-bold">Tell us about yourself</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Your name is shown to peers when you ask or answer a doubt.
          </p>

          <form className="mt-6 space-y-4" onSubmit={submit}>
            <Field label="Full name">
              <input
                value={form.name}
                onChange={set("name")}
                required
                autoComplete="name"
                placeholder="Ada Lovelace"
                className={inputClass}
              />
            </Field>

            <Field label="Date of birth">
              <input type="date" value={form.dob} onChange={set("dob")} className={inputClass} />
            </Field>

            <Field label="College">
              <input
                value={form.college}
                onChange={set("college")}
                placeholder="Indian Institute of Technology"
                className={inputClass}
              />
            </Field>

            <Field label="Degree">
              <select
                value={form.degree}
                onChange={(e) =>
                  // Courses are degree-specific, so changing degree clears the
                  // course rather than leaving a B.Tech course under B.Sc.
                  setForm((f) => ({ ...f, degree: e.target.value, courseSlug: "" }))
                }
                className={inputClass}
              >
                <option value="">Select your degree…</option>
                <option value="B.Tech">B.Tech</option>
                <option value="B.Sc">B.Sc</option>
              </select>
            </Field>

            <Field label="Course">
              <select
                value={form.courseSlug}
                onChange={set("courseSlug")}
                disabled={!form.degree}
                className={`${inputClass} disabled:opacity-50`}
              >
                <option value="">
                  {form.degree ? "Select your course…" : "Choose a degree first"}
                </option>
                {coursesForDegree.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Year">
              <select value={form.year} onChange={set("year")} className={inputClass}>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </Field>

            {selectedCourse && (
              <p className="rounded-lg bg-secondary px-3 py-2.5 text-xs text-muted-foreground">
                You'll see subjects from semesters{" "}
                <span className="font-semibold text-foreground">
                  {yearIndex * 2 - 1} and {yearIndex * 2}
                </span>{" "}
                of {selectedCourse.name}.
              </p>
            )}

            <button
              disabled={saving}
              className="mt-2 w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Continue"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-foreground">{label}</span>
      {children}
    </label>
  );
}
