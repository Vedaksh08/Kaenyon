import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";

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

function Landing() {
  return (
    <div className="relative min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <nav className="absolute top-6 right-6 flex items-center gap-4 text-sm">
        <Link to="/login" className="text-foreground hover:text-primary font-medium">
          Sign In
        </Link>
      </nav>

      <div className="w-full max-w-md rounded-2xl bg-card shadow-card p-10 text-center">
        <div className="inline-block border-[3px] border-double border-navy px-6 py-3">
          <div className="text-3xl font-extrabold tracking-tight text-navy">PATHWAAY</div>
        </div>
        <div className="mt-3 flex items-center justify-center gap-3 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          <span className="h-px w-10 bg-border" />
          Be Limitless
          <span className="h-px w-10 bg-border" />
        </div>

        <p className="mt-6 text-base text-foreground">The global peer-to-peer learning platform.</p>
        <Link to="/signup" className="mt-2 block text-sm text-primary hover:underline">
          Join the academic revolution.
        </Link>

        <Link
          to="/signup"
          className="mt-10 inline-flex w-full items-center justify-center rounded-xl bg-primary px-8 py-4 text-base font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Get Started →
        </Link>
      </div>

      <button className="fixed bottom-6 right-6 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-elevated hover:bg-primary/90">
        <MessageCircle className="h-5 w-5" />
      </button>
      <div className="fixed bottom-6 left-6 flex h-10 w-10 items-center justify-center rounded-full bg-navy text-sm font-bold text-white shadow-card">
        N
      </div>
    </div>
  );
}
