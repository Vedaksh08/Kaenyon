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

/** Mark plus wordmark. `size="lg"` for auth screens, default for chrome. */
export function PathwaayLogo({
  className,
  size = "md",
}: {
  className?: string;
  size?: "md" | "lg";
}) {
  return (
    <div className={cn("inline-flex items-center gap-2.5", className)}>
      <PathwaayMark className={size === "lg" ? "h-11 w-11" : "h-8 w-8"} />
      <span
        className={cn(
          "font-extrabold tracking-tight text-foreground",
          size === "lg" ? "text-3xl" : "text-xl",
        )}
      >
        Pathwaay
      </span>
    </div>
  );
}
