// File: src/view.ts
import { ItemView, MarkdownRenderer, TFile, WorkspaceLeaf, parseLinktext } from "obsidian";
import type ReferencePreviewPlugin from "./main";

export const VIEW_TYPE_REFERENCE_PREV = "reference-previews-view";

type ParsedSection = {
  key: string;
  entries: string[];
};

export class ReferencePreviewView extends ItemView {
  plugin: ReferencePreviewPlugin;

  private headerEl!: HTMLElement;
  private toolbarEl!: HTMLElement;
  private listEl!: HTMLElement;
  private sourcePath = "/";

  private collapsedKeysByFile = new Map<string, Set<string>>();

  constructor(leaf: WorkspaceLeaf, plugin: ReferencePreviewPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_REFERENCE_PREV;
  }
  getDisplayText() {
    return "Reference previews";
  }
  getIcon() {
    return "links-coming-in";
  }
  setPlugin(plugin: ReferencePreviewPlugin) {
    this.plugin = plugin;
  }

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

  private buildSections(file: TFile): ParsedSection[] {
    const { maxItems } = this.plugin.settings;
    const keys = (this.plugin.settings.frontmatterKeys || []).map((s) => s.trim()).filter(Boolean);

    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;

    const sections: ParsedSection[] = [];

    for (const k of keys.length ? keys : ["previewLinks"]) {
      const entries = this.parseFrontmatterValue(fm?.[k]);
      if (!entries.length) continue;
      const slice = maxItems && entries.length > maxItems ? entries.slice(0, maxItems) : entries;
      sections.push({ key: k, entries: slice });
    }

    if (this.plugin.settings.dedupe) {
      const seen = new Set<string>();
      for (const sec of sections) {
        const filtered: string[] = [];
        for (const e of sec.entries) {
          const ek = this.entryKey(sec.key, e);
          if (seen.has(ek)) continue;
          seen.add(ek);
          filtered.push(e);
        }
        sec.entries = filtered;
      }
    }

    return sections.filter((s) => s.entries.length);
  }

  async renderForFile(file: TFile) {
    if (!file) return;

    this.sourcePath = file.path;
    this.headerEl.setText(`Reference previews - ${file.basename}`);
    this.listEl.empty();

    const sections = this.buildSections(file);
    if (!sections.length) {
      const keys = (this.plugin.settings.frontmatterKeys || []).join(", ") || "previewLinks";
      this.listEl.createEl("div", {
        text: `No entries found in fields: ${keys}`,
        cls: "refprev-empty",
      });
      return;
    }

    const collapsed = this.collapsedKeysByFile.get(this.sourcePath) ?? new Set<string>();
    this.collapsedKeysByFile.set(this.sourcePath, collapsed);

    const showHeaders = !!this.plugin.settings.showPropertyHeaders;

    for (const sec of sections) {
      let targetContainer: HTMLElement = this.listEl;

      if (showHeaders) {
        const details = this.listEl.createEl("details", { cls: "refprev-section", attr: { open: "" } });
        const summary = details.createEl("summary", { cls: "refprev-section-title" });
        summary.setText(`${sec.key} (${sec.entries.length})`);
        targetContainer = details.createEl("div", { cls: "refprev-section-body" });
      }

      for (const entry of sec.entries) {
        const key = this.entryKey(sec.key, entry);
        const isCollapsed = collapsed.has(key);
        await this.renderOne(targetContainer, entry, key, isCollapsed);
      }
    }
  }

  private entryKey(propKey: string, entry: string): string {
    const m = entry.match(/^\[\[(.+?)\]\]$/);
    if (m) {
      const inside = m[1];
      const pipeIdx = inside.indexOf("|");
      const targetRaw = pipeIdx >= 0 ? inside.slice(0, pipeIdx) : inside;
      const targetNoExt = targetRaw.replace(/\.md$/i, "");
      const { path, subpath } = parseLinktext(targetNoExt);
      const sp = subpath ? `#${subpath}` : "";
      return `p:${propKey}|wikilink:${path || targetNoExt}${sp}`;
    }
    if (/^https?:\/\//i.test(entry)) return `p:${propKey}|url:${entry}`;
    return `p:${propKey}|txt:${entry}`;
  }

  private async renderOne(container: HTMLElement, entry: string, key: string, initiallyCollapsed: boolean) {
    const item = container.createEl("div", { cls: "refprev-item" });
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

    if (/^https?:\/\//i.test(entry)) {
      labelSpan.setText(entry);
      body.createEl("iframe", { cls: "refprev-iframe", attr: { src: entry, loading: "lazy" } });
      const open = body.createEl("div", { cls: "refprev-open" });
      open.createEl("a", { text: "Open in browser", href: entry, attr: { target: "_blank", rel: "noopener" } });
      return;
    }

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
