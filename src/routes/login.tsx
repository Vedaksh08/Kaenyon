import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SocialAuthButtons } from "@/components/social-auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign In — StudyAll" },
      {
        name: "description",
        content: "Sign in to StudyAll with a secure email verification link — no password needed.",
      },
      { property: "og:title", content: "Sign In — StudyAll" },
      {
        property: "og:description",
        content: "Sign in to StudyAll with a secure email verification link — no password needed.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-card shadow-card p-8">
        <div className="text-center">
          <div className="inline-block border-[3px] border-double border-navy px-4 py-2">
            <div className="text-xl font-extrabold tracking-tight text-navy">STUDYALL</div>
          </div>
        </div>

        {sent ? (
          <div className="mt-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
              <MailCheck className="h-7 w-7 text-primary" />
            </div>
            <h1 className="mt-4 text-2xl font-bold">Check your inbox</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We sent a verification email to{" "}
              <span className="font-semibold text-foreground">{email}</span>. Open it and tap the
              button inside to get instant access.
            </p>
            <button
              onClick={() => setSent(false)}
              className="mt-6 text-sm font-semibold text-primary hover:underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <h1 className="mt-6 text-center text-2xl font-bold">Welcome Back</h1>
            <p className="mt-1 text-center text-sm text-muted-foreground">
              Enter your email and we'll send you a secure sign-in link.
            </p>

            <form className="mt-6 space-y-4" onSubmit={sendLink}>
              <Field label="EMAIL">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
          New here?{" "}
          <Link to="/signup" className="font-semibold text-primary hover:underline">
            Create an account
          </Link>
        </p>
      </div>
      <style>{`
        .input { width: 100%; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--input); background: var(--background); font-size: 0.875rem; }
        .input:focus { outline: 2px solid var(--brand); outline-offset: 0; border-color: var(--brand); }
      `}</style>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export function Divider() {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">or</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
