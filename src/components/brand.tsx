import { cn } from "@/lib/utils";

/**
 * Kaenyon's mark: a stylised "K" formed from a solid stem and two chevrons
 * pointing outward — one asking, one answering.
 */
export function KaenyonMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("h-8 w-8", className)}
      role="img"
      aria-label="Kaenyon"
      fill="none"
    >
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path
        d="M11 8.5v15"
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
        className="text-primary-foreground"
      />
      <path
        d="M22 8.5 15 16l7 7.5"
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary-foreground"
      />
    </svg>
  );
}

/** Mark plus wordmark. `size="lg"` for auth screens, default for chrome. */
export function KaenyonLogo({
  className,
  size = "md",
}: {
  className?: string;
  size?: "md" | "lg";
}) {
  return (
    <div className={cn("inline-flex items-center gap-2.5", className)}>
      <KaenyonMark className={size === "lg" ? "h-11 w-11" : "h-8 w-8"} />
      <span
        className={cn(
          "font-extrabold tracking-tight text-foreground",
          size === "lg" ? "text-3xl" : "text-xl",
        )}
      >
        Kaenyon
      </span>
    </div>
  );
}
