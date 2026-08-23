import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SocialAuthButtons } from "@/components/social-auth";
import { PathwaayLogo } from "@/components/brand";

export const Route = createFileRoute("/login")({
  ssr: false,
  // Already signed in? Don't make them sign in again.
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      throw redirect({ to: "/home" });
    }
  },
  head: () => ({
    meta: [
      { title: "Sign in — Pathwaay" },
      {
        name: "description",
        content: "Sign in to Pathwaay and solve doubts live with students on your course.",
      },
      { property: "og:title", content: "Sign in — Pathwaay" },
      {
        property: "og:description",
        content: "Sign in to Pathwaay and solve doubts live with students on your course.",
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

  // One door for everyone. Supabase creates the account if the address is new,
  // and profile details are collected at /onboarding once they land.
  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex justify-center">
          <PathwaayLogo size="lg" />
        </div>

        {sent ? (
          <div className="mt-10 rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <MailCheck className="h-7 w-7 text-primary" />
            </div>
            <h1 className="mt-5 text-xl font-bold">Check your inbox</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              We sent a sign-in link to{" "}
              <span className="font-semibold text-foreground">{email.trim()}</span>. Open it on this
              device to continue.
            </p>
            <button
              onClick={() => setSent(false)}
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              <ArrowLeft className="h-4 w-4" /> Use a different email
            </button>
          </div>
        ) : (
          <div className="mt-10 rounded-2xl border border-border bg-card p-8 shadow-sm">
            <h1 className="text-center text-xl font-bold">Sign in to Pathwaay</h1>
            <p className="mt-1.5 text-center text-sm text-muted-foreground">
              No password needed — we'll email you a secure link.
            </p>

            <form className="mt-7 space-y-3" onSubmit={sendLink}>
              <label className="block">
                <span className="sr-only">Email address</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@college.edu"
                  className="w-full rounded-lg border border-input bg-background px-3.5 py-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25"
                />
              </label>
              <button
                disabled={loading}
                className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
              >
                {loading ? "Sending link…" : "Continue with email"}
              </button>
            </form>

            <Divider />

            <SocialAuthButtons />
          </div>
        )}

        <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
          New to Pathwaay? Entering your email above creates your account.
        </p>
      </div>
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
    <div className="my-6 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        or
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
