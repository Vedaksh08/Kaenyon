import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, MessagesSquare, ShieldCheck, Users } from "lucide-react";
import { PathwaayMark, PathwaayWordmark, Tagline } from "@/components/brand";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pathwaay — Be Limitless" },
      {
        name: "description",
        content: "The global peer-to-peer learning platform for college students.",
      },
    ],
  }),
  component: Landing,
});

/** The three things a first-time visitor actually wants to know. */
const POINTS = [
  { icon: Users, label: "Live classrooms", accent: "text-brand-cyan" },
  { icon: MessagesSquare, label: "Peer doubt solving", accent: "text-brand-lime" },
  { icon: ShieldCheck, label: "Moderated & safe", accent: "text-brand-violet" },
] as const;

function Landing() {
  return (
    /* The brand sheet is a wordmark on a deep blue plate, so the entry screen
     * is that plate — not a white card that happens to mention the name. */
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-brand text-white">
      {/* Light bloom behind the mark, so the flat blue has some depth. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-18%] h-[520px] w-[520px] -translate-x-1/2 rounded-full opacity-30 blur-[110px]"
        style={{
          background:
            "radial-gradient(circle, rgba(0,196,255,0.9) 0%, rgba(168,85,247,0.5) 55%, transparent 72%)",
        }}
      />

      <nav className="relative z-10 flex items-center justify-between gap-3 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-6">
        <PathwaayWordmark tone="onDark" className="min-w-0 truncate text-[11px] sm:text-[13px]" />
        <Link
          to="/login"
          className="shrink-0 rounded-full border border-white/25 px-4 py-1.5 text-sm font-semibold text-white transition hover:border-white/60 hover:bg-white/10"
        >
          Sign In
        </Link>
      </nav>

      <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <PathwaayMark className="h-24 w-24 drop-shadow-[0_8px_28px_rgba(0,0,0,0.35)] sm:h-28 sm:w-28" />

        {/* Tracked caps are much wider than their font-size suggests — eight
         * letters at 0.22em tracking run ~2.4x the cap height each. Sizing off
         * vw keeps the mark inside the viewport instead of clipping it. */}
        <h1 className="wordmark mt-7 w-full text-[clamp(1.5rem,7.2vw,3rem)] leading-none text-white">
          Pathwaay
        </h1>
        <Tagline size="lg" tone="onDark" />

        <p className="mt-8 max-w-sm text-balance text-lg leading-relaxed text-white/85">
          The global peer-to-peer learning platform. Join a live classroom, ask your doubt, and get
          it solved by someone on your course.
        </p>

        <Link
          to="/signup"
          className="group mt-9 inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-white px-8 py-4 text-base font-bold text-brand shadow-elevated transition hover:bg-white/90 active:scale-[0.98]"
        >
          Get Started
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
        <Link
          to="/login"
          className="mt-4 text-sm font-medium text-white/70 underline-offset-4 transition hover:text-white hover:underline"
        >
          I already have an account
        </Link>

        <ul className="mt-12 flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
          {POINTS.map(({ icon: Icon, label, accent }) => (
            <li key={label} className="flex items-center gap-2 text-sm font-medium text-white/75">
              <Icon className={`h-4 w-4 ${accent}`} />
              {label}
            </li>
          ))}
        </ul>
      </main>

      {/* The mark's four bars, closing the page the way they open the logo. */}
      <div aria-hidden className="brand-rainbow relative z-10 h-1 w-full shrink-0" />
    </div>
  );
}
