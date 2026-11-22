import { ChangeOverlay, mergeOverlays } from "./changeOverlay";

/**
 * What the extension knows about the current change, per workspace folder:
 * the working tree's impact and the API-surface comparison with a base. The
 * Impact view sets them as it computes; the Changed Elements view and the
 * open report listen. No `vscode` import.
 */
export class ChangeOverlayHub {
  private readonly parts = new Map<string, { impact?: ChangeOverlay; surface?: ChangeOverlay }>();
  private readonly listeners = new Set<(folderKey: string) => void>();

  setImpact(folderKey: string, overlay: ChangeOverlay | null): void {
    this.set(folderKey, "impact", overlay);
  }

  setSurface(folderKey: string, overlay: ChangeOverlay | null): void {
    this.set(folderKey, "surface", overlay);
  }

  private set(folderKey: string, part: "impact" | "surface", overlay: ChangeOverlay | null): void {
    const had = this.parts.get(folderKey) ?? {};
    const next = { ...had, [part]: overlay ?? undefined };
    if (JSON.stringify(had[part] ?? null) === JSON.stringify(overlay)) return;
    this.parts.set(folderKey, next);
    for (const l of this.listeners) l(folderKey);
  }

  /** The folder's overlay: both parts merged, strongest kind per element; null when there is none. */
  get(folderKey: string): ChangeOverlay | null {
    const p = this.parts.get(folderKey);
    return p ? mergeOverlays([p.surface, p.impact]) : null;
  }

  onDidChange(listener: (folderKey: string) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  }
}

/** The one hub of this extension host. */
export const changeHub = new ChangeOverlayHub();
