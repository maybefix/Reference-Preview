import {
  ItemView,
  MarkdownRenderer,
  TFile,
  WorkspaceLeaf,
  parseLinktext,
} from "obsidian";
import type ReferencePreviewPlugin from "./main";

export const VIEW_TYPE_REFERENCE_PREV = "reference-previews-view";

export class ReferencePreviewView extends ItemView {
  plugin: ReferencePreviewPlugin;

  private headerEl!: HTMLElement;
  private toolbarEl!: HTMLElement;
  private listEl!: HTMLElement;
  private sourcePath = "/";

  // 折り畳み状態を「エントリキー」単位で保持（ファイルパス → Set<key>）
  private collapsedKeysByFile = new Map<string, Set<string>>();

  constructor(leaf: WorkspaceLeaf, plugin: ReferencePreviewPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE_REFERENCE_PREV; }
  getDisplayText() { return "Reference previews"; }
  getIcon() { return "links-coming-in"; }
  setPlugin(plugin: ReferencePreviewPlugin) { this.plugin = plugin; }

  async onOpen() {
    const root = this.containerEl;
    root.empty();
    root.addClass("refprev-root");

    this.headerEl = root.createEl("div", { cls: "refprev-header" });

    this.toolbarEl = root.createEl("div", { cls: "refprev-toolbar" });
    const expandAllBtn = this.toolbarEl.createEl("button", { cls: "refprev-btn", text: "Expand all" });
    const collapseAllBtn = this.toolbarEl.createEl("button", { cls: "refprev-btn", text: "Collapse all" });
    expandAllBtn.addEventListener("click", () => this.setAllCollapsed(false));
    collapseAllBtn.addEventListener("click", () => this.setAllCollapsed(true));

    this.listEl = root.createEl("div", { cls: "refprev-list" });
  }

  async onClose() {}

  async renderForFile(file: TFile) {
    if (!file) return;

    this.sourcePath = file.path;
    const { frontmatterKey, maxItems } = this.plugin.settings;
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;

    this.headerEl.setText(`Reference previews — ${file.basename}`);
    this.listEl.empty();

    if (!fm || fm[frontmatterKey] == null) {
      this.listEl.createEl("div", { text: `Frontmatter field "${frontmatterKey}" not found.`, cls: "refprev-empty" });
      return;
    }

    let entries: string[] = [];
    const raw = fm[frontmatterKey];
    if (Array.isArray(raw)) entries = raw.map(String);
    else if (typeof raw === "string")
      entries = raw.split(/\n|,|;/).map(s => s.trim()).filter(Boolean);

    if (!entries.length) {
      this.listEl.createEl("div", { text: "No entries.", cls: "refprev-empty" });
      return;
    }

    const collapsed = this.collapsedKeysByFile.get(this.sourcePath) ?? new Set<string>();
    this.collapsedKeysByFile.set(this.sourcePath, collapsed);

    const slice = maxItems && entries.length > maxItems ? entries.slice(0, maxItems) : entries;

    for (const entry of slice) {
      const key = this.entryKey(entry);
      const isCollapsed = collapsed.has(key);
      await this.renderOne(entry, key, isCollapsed);
    }
  }

  // エントリから安定キーを生成（インデックスに依存しない）
  private entryKey(entry: string): string {
    const m = entry.match(/^\[\[(.+?)\]\]$/);
    if (m) {
      const inside = m[1];
      const pipeIdx = inside.indexOf("|");
      const targetRaw = pipeIdx >= 0 ? inside.slice(0, pipeIdx) : inside; // aliasは無視
      const targetNoExt = targetRaw.replace(/\.md$/i, "");
      const { path, subpath } = parseLinktext(targetNoExt);
      const sp = subpath ? `#${subpath}` : "";
      return `wikilink:${path || targetNoExt}${sp}`;
    }
    if (/^https?:\/\//i.test(entry)) return `url:${entry}`;
    return `txt:${entry}`;
  }

  private async renderOne(entry: string, key: string, initiallyCollapsed: boolean) {
    const item = this.listEl.createEl("div", { cls: "refprev-item" });
    item.setAttr("data-key", key);
    if (initiallyCollapsed) item.addClass("is-collapsed");

    const head = item.createEl("div", { cls: "refprev-item-head" });
    const toggle = head.createEl("button", {
      cls: "refprev-toggle",
      attr: { "aria-expanded": String(!initiallyCollapsed) },
      text: initiallyCollapsed ? "▶" : "▼",
    });
    const labelSpan = head.createEl("span", { cls: "refprev-item-label" });

    const body = item.createEl("div", { cls: "refprev-item-body" });

    toggle.addEventListener("click", () => {
      const nextCollapsed = !item.hasClass("is-collapsed");
      item.toggleClass("is-collapsed", nextCollapsed);
      toggle.setText(nextCollapsed ? "▶" : "▼");
      toggle.setAttr("aria-expanded", String(!nextCollapsed));
      this.setCollapsedByKey(key, nextCollapsed);
    });

    // 1) wikiリンク
    const m = entry.match(/^\[\[(.+?)\]\]$/);
    if (m) {
      const inside = m[1];
      const pipeIdx = inside.indexOf("|");
      const targetRaw = pipeIdx >= 0 ? inside.slice(0, pipeIdx) : inside;
      const alias = pipeIdx >= 0 ? inside.slice(pipeIdx + 1) : null;

      const targetNoExt = targetRaw.replace(/\.md$/i, "");
      const { path, subpath } = parseLinktext(targetNoExt);
      const f = this.app.metadataCache.getFirstLinkpathDest(path || targetNoExt, this.sourcePath);

      labelSpan.setText(alias ?? entry);

      if (f) {
        const sub = subpath ? `#${subpath}` : "";
        const md = `![[${f.path}${sub}]]`;
        body.addClass("markdown-rendered", "refprev-md");
        await MarkdownRenderer.render(this.app, md, body, f.path, this);
      } else {
        body.createEl("div", { text: `Not found: ${targetNoExt}`, cls: "refprev-empty" });
      }
      return;
    }

    // 2) URL
    if (/^https?:\/\//i.test(entry)) {
      labelSpan.setText(entry);
      body.createEl("iframe", { cls: "refprev-iframe", attr: { src: entry, loading: "lazy" } });
      const open = body.createEl("div", { cls: "refprev-open" });
      open.createEl("a", { text: "Open in browser", href: entry, attr: { target: "_blank", rel: "noopener" } });
      return;
    }

    // 3) その他
    labelSpan.setText(entry);
    body.createEl("div", { text: "Not a wikilink or URL.", cls: "refprev-empty" });
  }

  private setCollapsedByKey(key: string, collapsed: boolean) {
    const set = this.collapsedKeysByFile.get(this.sourcePath) ?? new Set<string>();
    if (collapsed) set.add(key);
    else set.delete(key);
    this.collapsedKeysByFile.set(this.sourcePath, set);
  }

  private setAllCollapsed(collapsed: boolean) {
    const set = this.collapsedKeysByFile.get(this.sourcePath) ?? new Set<string>();
    const items = this.listEl.querySelectorAll<HTMLElement>(".refprev-item");
    items.forEach((el) => {
      const key = el.getAttribute("data-key") || "";
      if (collapsed) {
        el.addClass("is-collapsed");
        set.add(key);
      } else {
        el.removeClass("is-collapsed");
        set.delete(key);
      }
      const btn = el.querySelector<HTMLButtonElement>(".refprev-toggle");
      if (btn) {
        btn.textContent = collapsed ? "▶" : "▼";
        btn.setAttribute("aria-expanded", String(!collapsed));
      }
    });
    this.collapsedKeysByFile.set(this.sourcePath, set);
  }
}
