import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { MailCheck } from "lucide-react";
import { Field, Divider } from "./login";
import { supabase } from "@/integrations/supabase/client";
import { SocialAuthButtons } from "@/components/social-auth";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Sign Up — StudyAll" },
      {
        name: "description",
        content:
          "Create your free StudyAll account with email verification and start solving doubts with students worldwide.",
      },
      { property: "og:title", content: "Sign Up — StudyAll" },
      {
        property: "og:description",
        content:
          "Create your free StudyAll account with email verification and start solving doubts with students worldwide.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    const college = String(fd.get("college") || "").trim();
    const course = String(fd.get("course") || "").trim();
    const year = String(fd.get("year") || "").trim();
    const email = String(fd.get("email") || "").trim();

    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: { name, college, course, year },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSentTo(email);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-card shadow-card p-8">
        <div className="text-center">
          <div className="inline-block border-[3px] border-double border-navy px-4 py-2">
            <div className="text-xl font-extrabold tracking-tight text-navy">STUDYALL</div>
          </div>
        </div>

        {sentTo ? (
          <div className="mt-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
              <MailCheck className="h-7 w-7 text-primary" />
            </div>
            <h1 className="mt-4 text-2xl font-bold">Verify your email</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We sent a verification email to{" "}
              <span className="font-semibold text-foreground">{sentTo}</span>. Tap the button in
              that email and you'll be signed straight in.
            </p>
            <Link
              to="/login"
              className="mt-6 inline-block text-sm font-semibold text-primary hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="mt-6 text-center text-2xl font-bold">Create your account</h1>
            <p className="mt-1 text-center text-sm text-muted-foreground">
              Fill in your details and we'll email you a secure sign-in link.
            </p>

            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
              <Field label="STUDENT NAME">
                <input name="name" required className="input" />
              </Field>
              <Field label="COLLEGE/SCHOOL NAME">
                <input name="college" required className="input" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="COURSE">
                  <input name="course" required className="input" />
                </Field>
                <Field label="YEAR">
                  <select name="year" className="input">
                    <option>1st</option>
                    <option>2nd</option>
                    <option>3rd</option>
                    <option>4th</option>
                  </select>
                </Field>
              </div>
              <Field label="EMAIL">
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="you@gmail.com"
                  className="input"
                />
              </Field>

              <button
                disabled={loading}
                className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {loading ? "Sending link…" : "Send verification email"}
              </button>
            </form>

            <Divider />

            <div className="mt-2">
              <SocialAuthButtons />
            </div>
          </>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Sign In
          </Link>
        </p>
      </div>
      <style>{`
        .input { width: 100%; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--input); background: var(--background); font-size: 0.875rem; }
        .input:focus { outline: 2px solid var(--brand); border-color: var(--brand); }
      `}</style>
    </div>
  );
}
