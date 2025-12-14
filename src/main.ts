// File: src/main.ts
import { Plugin, TFile, WorkspaceLeaf, debounce, View } from "obsidian";
import { ReorderAndAddModal } from "./reorder-add-modal";
import { ReferencePreviewView, VIEW_TYPE_REFERENCE_PREV } from "./view";
import {
  ReferencePreviewSettingTab,
  DEFAULT_SETTINGS,
  ReferencePreviewSettings,
  ReferencePreviewOpenMode,
} from "./settings";

type LinksByKey = Record<string, string[]>;

export default class ReferencePreviewPlugin extends Plugin {
  settings: ReferencePreviewSettings;
  private refreshActiveView = debounce(() => this.updateViewForActiveFile(), 250);

  // 対象フロントマター配列の「署名」を保持（変化した時だけ再描画）
  private fmSigByPath = new Map<string, string>();

  private parseFrontmatterValue(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw === "string") {
      return raw
        .split(/\n|,|;/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  }

  private getEffectiveKeys(): string[] {
    const keys = (this.settings.frontmatterKeys || []).map((s) => s.trim()).filter(Boolean);
    if (!keys.length) return ["previewLinks"];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const k of keys) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
    return out;
  }

  private pickInitialEditKey(file: TFile): string {
    const keys = this.getEffectiveKeys();
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;

    for (const k of keys) {
      const raw = fm?.[k];
      const list = this.parseFrontmatterValue(raw);
      if (list.length) return k;
    }

    const def = (this.settings.defaultFrontmatterKey || "").trim();
    if (def && keys.includes(def)) return def;

    return keys[0];
  }

  private getPreviewList(file: TFile, key: string): string[] {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    return this.parseFrontmatterValue(fm?.[key]);
  }

  private getPreviewListsByKey(file: TFile): LinksByKey {
    const keys = this.getEffectiveKeys();
    const out: LinksByKey = {};
    for (const k of keys) out[k] = this.getPreviewList(file, k);
    return out;
  }

  private async setPreviewList(file: TFile, key: string, list: string[]) {
    const current = this.getPreviewList(file, key);
    const same = current.length === list.length && current.every((v, i) => v === list[i]);
    if (same) return;

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (!list.length) delete fm[key];
      else fm[key] = list;
    });
  }

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_REFERENCE_PREV, (leaf) => new ReferencePreviewView(leaf, this));

    this.addCommand({
      id: "open-reference-previews",
      name: "Open reference previews for current note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.openViewForFile(file);
        return true;
      },
    });

    this.addCommand({
      id: "edit-preview-links-add-and-reorder",
      name: "Edit preview links (add & reorder)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;

        const keys = this.getEffectiveKeys();
        const initialKey = this.pickInitialEditKey(file);
        const initialByKey = this.getPreviewListsByKey(file);

        if (!checking) {
          new ReorderAndAddModal(this.app, file, keys, initialKey, initialByKey, async (byKey) => {
            for (const k of keys) {
              if (byKey[k]) await this.setPreviewList(file, k, byKey[k]);
              else await this.setPreviewList(file, k, []);
            }

            const leaf = this.getExistingViewLeaf();
            if (leaf && this.isRefPrevView(leaf.view)) {
              await leaf.view.renderForFile(file);
              this.fmSigByPath.set(file.path, this.computeFrontmatterSig(file));
            }
          }).open();
        }
        return true;
      },
    });

    this.addSettingTab(new ReferencePreviewSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (!this.settings.autoOpen) return;
        this.refreshActiveView();
      })
    );

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        const active = this.app.workspace.getActiveFile();
        if (!active || file?.path !== active.path) return;

        const newSig = this.computeFrontmatterSig(active);
        const oldSig = this.fmSigByPath.get(active.path);
        if (newSig === oldSig) return;

        this.fmSigByPath.set(active.path, newSig);
        const leaf = this.getExistingViewLeaf();
        if (leaf && this.isRefPrevView(leaf.view)) {
          void leaf.view.renderForFile(active);
        }
      })
    );
  }

  onunload() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_REFERENCE_PREV).forEach((l) => l.detach());
  }

  async loadSettings() {
    const raw = await this.loadData();

    // migrate older versions
    const merged: any = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    if (merged.frontmatterKey && !merged.frontmatterKeys) {
      merged.frontmatterKeys = [String(merged.frontmatterKey)];
    }
    if (!merged.defaultFrontmatterKey) {
      merged.defaultFrontmatterKey =
        Array.isArray(merged.frontmatterKeys) && merged.frontmatterKeys.length ? merged.frontmatterKeys[0] : "previewLinks";
    }
    if (!merged.openMode) {
      if (typeof merged.splitAdjacent === "boolean") merged.openMode = merged.splitAdjacent ? "split" : "reuse";
      else merged.openMode = "split";
    }

    merged.frontmatterKeys = (Array.isArray(merged.frontmatterKeys) ? merged.frontmatterKeys : ["previewLinks"])
      .map((s: any) => String(s).trim())
      .filter(Boolean);

    if (!merged.frontmatterKeys.length) merged.frontmatterKeys = ["previewLinks"];
    if (!merged.frontmatterKeys.includes(merged.defaultFrontmatterKey)) merged.defaultFrontmatterKey = merged.frontmatterKeys[0];

    this.settings = merged as ReferencePreviewSettings;
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async getOrCreateLeaf(): Promise<WorkspaceLeaf> {
    const existing = this.getExistingViewLeaf();
    if (existing) return existing;

    const mode: ReferencePreviewOpenMode = this.settings.openMode || "split";
    if (mode === "tab") return this.app.workspace.getLeaf("tab");
    if (mode === "reuse") return this.app.workspace.getLeaf("tab");
    return this.app.workspace.getLeaf("split");
  }

  async openViewForFile(file: TFile) {
    const leaf = await this.getOrCreateLeaf();
    await leaf.setViewState({ type: VIEW_TYPE_REFERENCE_PREV, active: true });

    const v = leaf.view;
    if (this.isRefPrevView(v)) {
      v.setPlugin(this);
      await v.renderForFile(file);
      this.fmSigByPath.set(file.path, this.computeFrontmatterSig(file));
    }
  }

  async updateViewForActiveFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;

    const leaf = this.getExistingViewLeaf();
    if (leaf && this.isRefPrevView(leaf.view)) {
      await leaf.view.renderForFile(file);
      this.fmSigByPath.set(file.path, this.computeFrontmatterSig(file));
    } else if (this.settings.autoOpen) {
      await this.openViewForFile(file);
    }
  }

  getExistingViewLeaf(): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_REFERENCE_PREV);
    return leaves.length ? leaves[0] : null;
  }

  private isRefPrevView(v: View): v is ReferencePreviewView {
    return (v as any)?.getViewType?.() === VIEW_TYPE_REFERENCE_PREV;
  }

  private computeFrontmatterSig(file: TFile): string {
    const keys = this.getEffectiveKeys();
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;

    const payload: Record<string, string[]> = {};
    for (const k of keys) payload[k] = this.parseFrontmatterValue(fm?.[k]);

    return JSON.stringify({ keys, payload });
  }
}
