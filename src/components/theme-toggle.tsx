import { Moon, Sun } from "lucide-react";
import { usePlan } from "@/lib/plan-context";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = usePlan();
  return (
    <button
      onClick={toggleTheme}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle theme"
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-card transition hover:bg-secondary ${className}`}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
