import { Notice, Plugin, TFile, WorkspaceLeaf, debounce, View } from "obsidian";
import { ReorderAndAddModal } from "./reorder-add-modal";
import { ReferencePreviewView, VIEW_TYPE_REFERENCE_PREV } from "./view";
import { ReferencePreviewSettingTab, DEFAULT_SETTINGS, ReferencePreviewSettings } from "./settings";

export default class ReferencePreviewPlugin extends Plugin {
  settings: ReferencePreviewSettings;
  private refreshActiveView = debounce(() => this.updateViewForActiveFile(), 250);

  // 対象フロントマター配列の「署名」を保持（変化した時だけ再描画）
  private fmSigByPath = new Map<string, string>();

  // ▼ フロントマター読取り
  private getPreviewList(file: TFile): string[] {
    const key = this.settings.frontmatterKey;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const raw = fm?.[key];
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw === "string") return raw.split(/\n|,|;/).map(s => s.trim()).filter(Boolean);
    return [];
  }

  // ▼ フロントマター書き戻し（YAML配列）
  private async setPreviewList(file: TFile, list: string[]) {
    const key = this.settings.frontmatterKey;
    const current = this.getPreviewList(file);
    const same = current.length === list.length && current.every((v, i) => v === list[i]);
    if (same) return; // 変化なしなら書かない（無駄な整形を避ける）

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[key] = list;
    });
  }

  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_REFERENCE_PREV,
      (leaf) => new ReferencePreviewView(leaf, this)
    );

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

        const current = this.getPreviewList(file);
        if (!checking) {
          new ReorderAndAddModal(this.app, file, current, async (newOrder) => {
            await this.setPreviewList(file, newOrder);
            // 即時反映
            const leaf = this.getExistingViewLeaf();
            if (leaf && (leaf.view as any)?.getViewType?.() === VIEW_TYPE_REFERENCE_PREV) {
              (leaf.view as ReferencePreviewView).renderForFile(file);
            }
          }).open();
        }
        return true;
      }
    });

    this.addSettingTab(new ReferencePreviewSettingTab(this.app, this));

    // アクティブノート切替に追従（必要時のみ）
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (!this.settings.autoOpen) return;
        this.refreshActiveView();
      })
    );

    // メタデータ更新：対象フロントマターが変わった時だけ再描画
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        const active = this.app.workspace.getActiveFile();
        if (!active || file?.path !== active.path) return;

        const newSig = this.computeFrontmatterSig(active);
        const oldSig = this.fmSigByPath.get(active.path);
        if (newSig === oldSig) return; // 本文編集など、プレビュー対象に変化なし

        this.fmSigByPath.set(active.path, newSig);
        const leaf = this.getExistingViewLeaf();
        if (leaf && this.isRefPrevView(leaf.view)) {
          leaf.view.renderForFile(active);
        }
      })
    );
  }

  onunload() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_REFERENCE_PREV).forEach((l) => l.detach());
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async openViewForFile(file: TFile) {
    // メインエリアで分割して開く（サイドバーではなく隣ペイン）
    let leaf: WorkspaceLeaf = this.app.workspace.getLeaf("split");
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
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    const key = this.settings.frontmatterKey;
    const raw = fm?.[key];

    let entries: string[] = [];
    if (Array.isArray(raw)) entries = raw.map(String);
    else if (typeof raw === "string")
      entries = raw.split(/\n|,|;/).map((s) => s.trim()).filter(Boolean);

    // 配列内容だけを署名化（順序も含めて比較）
    return JSON.stringify(entries);
  }
}
