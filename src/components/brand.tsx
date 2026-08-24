import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Pathwaay's mark: an open book whose pages rise as coloured bars.
 *
 * Two files rather than one recoloured SVG, because the artwork itself differs
 * between themes — the light version sits on blue, the dark on navy. Both are
 * always in the DOM and swapped with CSS so there is no flash on theme change
 * and no JavaScript needed to pick one.
 */
export function PathwaayMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-block h-8 w-8 shrink-0", className)}>
      <img
        src="/logo-light.png"
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full rounded-[22%] object-contain dark:hidden"
      />
      <img
        src="/logo-dark.png"
        alt=""
        aria-hidden
        className="absolute inset-0 hidden h-full w-full rounded-[22%] object-contain dark:block"
      />
    </span>
  );
}

/**
 * The wordmark on its own, set the way the brand sheet sets it: wide geometric
 * caps in Jura. The spacing and casing live in the `wordmark` utility so the
 * name looks identical everywhere it appears — a wordmark that is retyped with
 * different tracking on each screen stops reading as one brand.
 *
 * `tone` picks the colour: "brand" for light surfaces, "onDark" inside the
 * classroom and other dark chrome.
 */
export function PathwaayWordmark({
  className,
  tone = "brand",
}: {
  className?: string;
  tone?: "brand" | "onDark" | "inherit";
}) {
  return (
    <span
      className={cn(
        "wordmark leading-none",
        tone === "brand" && "text-primary",
        tone === "onDark" && "text-white",
        className,
      )}
    >
      Pathwaay
    </span>
  );
}

/**
 * Mark plus wordmark. `size="lg"` for auth screens, default for chrome.
 * `tagline` adds "Be Limitless" underneath — worth it on entry screens, noise
 * anywhere it appears next to other UI.
 */
export function PathwaayLogo({
  className,
  size = "md",
  tagline = false,
  tone = "brand",
}: {
  className?: string;
  size?: "md" | "lg";
  tagline?: boolean;
  tone?: "brand" | "onDark";
}) {
  return (
    <div className={cn("inline-flex flex-col items-center", className)}>
      <div className="inline-flex items-center gap-3">
        <PathwaayMark className={size === "lg" ? "h-16 w-16" : "h-10 w-10"} />
        <PathwaayWordmark tone={tone} className={size === "lg" ? "text-3xl" : "text-xl"} />
      </div>
      {tagline && <Tagline size={size} tone={tone} />}
    </div>
  );
}

/**
 * "Be Limitless", ruled either side by the four bars of the mark so the tagline
 * carries the brand colours even where the logo is small.
 */
export function Tagline({
  size = "md",
  tone = "brand",
}: {
  size?: "md" | "lg";
  tone?: "brand" | "onDark";
}) {
  return (
    <span
      className={cn(
        "mt-2.5 flex items-center gap-2.5 font-semibold uppercase tracking-[0.3em]",
        size === "lg" ? "text-[10px]" : "text-[9px]",
        tone === "onDark" ? "text-white/60" : "text-muted-foreground",
      )}
    >
      <span className="brand-rainbow h-px w-8 rounded-full opacity-80" />
      Be Limitless
      <span className="brand-rainbow h-px w-8 rotate-180 rounded-full opacity-80" />
    </span>
  );
}

/**
 * The header every signed-in tab wears. Pathwaay's name and mark sit in the
 * same place on every screen, with the tab's own title beneath — previously
 * some tabs showed the mark, some showed nothing, and the app never named
 * itself once you were inside it.
 *
 * `accent` tints the thin rule under the header with one of the mark's bars, so
 * tabs stay distinguishable at a glance without each inventing its own colour.
 */
export function AppHeader({
  title,
  subtitle,
  accent = "cyan",
  action,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  accent?: "cyan" | "lime" | "amber" | "violet";
  action?: ReactNode;
  className?: string;
}) {
  const bar = {
    cyan: "bg-brand-cyan",
    lime: "bg-brand-lime",
    amber: "bg-brand-amber",
    violet: "bg-brand-violet",
  }[accent];

  return (
    <header
      className={cn(
        // overflow-hidden so the accent rule follows the header's corners when
        // a caller rounds it, rather than squaring off past them.
        "sticky top-0 z-30 overflow-hidden border-b border-border bg-background/85 backdrop-blur-md",
        className,
      )}
    >
      <div className="px-5 pb-3 pt-[max(0.875rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2.5">
          <PathwaayMark className="h-7 w-7" />
          <PathwaayWordmark className="text-[13px]" />
          <span className="ml-auto flex items-center gap-2">{action}</span>
        </div>
        <div className="mt-2.5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-extrabold leading-tight tracking-tight text-foreground">
              {title}
            </h1>
            {subtitle && (
              <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{subtitle}</div>
            )}
          </div>
        </div>
      </div>
      <span className={cn("block h-[3px] w-full", bar)} />
    </header>
  );
}
