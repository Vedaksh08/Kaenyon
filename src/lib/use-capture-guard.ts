import { useEffect, useState } from "react";

/**
 * Discourages screenshots and screen recording of a live classroom.
 *
 * Read this before relying on it: **a web page cannot block a screenshot.**
 * PrtScn, Win+Shift+S, Cmd+Shift+4, OBS, and a second phone pointed at the
 * monitor all happen outside the browser, and no web API can see or stop them.
 * Anyone claiming otherwise is selling something.
 *
 * What is actually possible, and what this does:
 *
 * - **Blur the video when the window loses focus.** The common screenshot
 *   shortcuts and snipping tools take focus away from the page first, so the
 *   frames they capture are blurred. Alt-tabbing also blurs, which is a
 *   reasonable privacy default anyway.
 * - **Swallow the obvious shortcuts** (PrintScreen, Ctrl/Cmd+Shift+S) so the
 *   casual attempt does nothing and the person is told why.
 * - **Disable the right-click menu and drag-saving** on video, removing the
 *   easiest "save this frame" paths.
 *
 * Determined capture still works. Treat this as a social signal — it makes
 * recording a deliberate act rather than a thoughtless one — and pair it with
 * the visible watermark, which survives into any screenshot that is taken.
 */
export function useCaptureGuard(enabled: boolean) {
  const [obscured, setObscured] = useState(false);
  const [warned, setWarned] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setObscured(false);
      return;
    }

    const hide = () => setObscured(true);
    const show = () => setObscured(false);

    // Screenshot tools and the OS snipper steal focus before they capture.
    const onVisibility = () => (document.hidden ? hide() : show());

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const isPrintScreen = key === "PrintScreen" || key === "Snapshot";
      const isSnip = (e.metaKey || e.ctrlKey) && e.shiftKey && /^[s3456]$/i.test(key);
      if (!isPrintScreen && !isSnip) return;
      e.preventDefault();
      hide();
      setWarned(true);
      // Clearing the clipboard is best-effort and often refused without a user
      // gesture; failing is fine, the blur is what matters.
      void navigator.clipboard?.writeText("").catch(() => {});
      window.setTimeout(show, 1200);
    };

    const onContextMenu = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "VIDEO" || el?.closest("video")) e.preventDefault();
    };

    const onDragStart = (e: DragEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "VIDEO" || el?.tagName === "IMG") e.preventDefault();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", hide);
    window.addEventListener("focus", show);
    window.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("dragstart", onDragStart);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", hide);
      window.removeEventListener("focus", show);
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("dragstart", onDragStart);
    };
  }, [enabled]);

  return { obscured, warned, dismissWarning: () => setWarned(false) };
}
