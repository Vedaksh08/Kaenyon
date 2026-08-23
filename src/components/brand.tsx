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
 * Mark plus wordmark. `size="lg"` for auth screens, default for chrome.
 * `tagline` adds "Be Limitless" underneath — worth it on entry screens, noise
 * anywhere it appears next to other UI.
 */
export function PathwaayLogo({
  className,
  size = "md",
  tagline = false,
}: {
  className?: string;
  size?: "md" | "lg";
  tagline?: boolean;
}) {
  return (
    <div className={cn("inline-flex flex-col items-center", className)}>
      <div className="inline-flex items-center gap-3">
        <PathwaayMark className={size === "lg" ? "h-16 w-16" : "h-10 w-10"} />
        <span
          className={cn(
            "font-extrabold tracking-tight text-foreground",
            size === "lg" ? "text-4xl" : "text-2xl",
          )}
        >
          Pathwaay
        </span>
      </div>
      {tagline && (
        <span
          className={cn(
            "mt-1.5 font-semibold uppercase tracking-[0.25em] text-muted-foreground",
            size === "lg" ? "text-[11px]" : "text-[9px]",
          )}
        >
          Be Limitless
        </span>
      )}
    </div>
  );
}
