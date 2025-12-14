// File: src/settings.ts
import { App, PluginSettingTab, Setting } from "obsidian";
import type ReferencePreviewPlugin from "./main";

export type ReferencePreviewOpenMode = "split" | "tab" | "reuse";

export interface ReferencePreviewSettings {
  /** Keys to read links from, in display order */
  frontmatterKeys: string[];
  /** Default key used when adding/editing */
  defaultFrontmatterKey: string;

  autoOpen: boolean;
  /** Where to open the preview view */
  openMode: ReferencePreviewOpenMode;

  /** 0 = unlimited */
  maxItems: number;

  /** Remove duplicates across properties (first occurrence wins) */
  dedupe: boolean;

  /** Show a header per property in the preview view */
  showPropertyHeaders: boolean;
}

export const DEFAULT_SETTINGS: ReferencePreviewSettings = {
  frontmatterKeys: ["previewLinks"],
  defaultFrontmatterKey: "previewLinks",
  autoOpen: true,
  openMode: "split",
  maxItems: 0,
  dedupe: true,
  showPropertyHeaders: true,
};

function parseKeysInput(v: string): string[] {
  const parts = v
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // unique while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

export class ReferencePreviewSettingTab extends PluginSettingTab {
  plugin: ReferencePreviewPlugin;

  private defaultKeySelectEl: HTMLSelectElement | null = null;

  constructor(app: App, plugin: ReferencePreviewPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private parseKeysInput(v: string): string[] {
    const parts = v
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of parts) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
    return out.length ? out : ["previewLinks"];
  }

  private syncDefaultKeyDropdown(keepValue?: string) {
    const sel = this.defaultKeySelectEl;
    if (!sel) return;

    const keys = this.plugin.settings.frontmatterKeys?.length
      ? this.plugin.settings.frontmatterKeys
      : ["previewLinks"];

    const prev = keepValue ?? sel.value;

    while (sel.options.length > 0) sel.remove(0);

    for (const k of keys) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.text = k;
      sel.add(opt);
    }

    let next = prev;
    if (!keys.includes(next)) next = this.plugin.settings.defaultFrontmatterKey;
    if (!keys.includes(next)) next = keys[0];

    this.plugin.settings.defaultFrontmatterKey = next;
    sel.value = next;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Reference Previews" });

    // Frontmatter fields
    new Setting(containerEl)
      .setName("Frontmatter fields")
      .setDesc("Comma-separated YAML keys. Example: previewLinks, specLinks, meetingLinks")
      .addText((t) => {
        t.setPlaceholder("previewLinks, specLinks, meetingLinks")
          .setValue((this.plugin.settings.frontmatterKeys ?? ["previewLinks"]).join(", "))
          .onChange(async (v) => {
            const nextKeys = this.parseKeysInput(v);
            const prevDefault = this.plugin.settings.defaultFrontmatterKey;

            this.plugin.settings.frontmatterKeys = nextKeys;

            if (!nextKeys.includes(this.plugin.settings.defaultFrontmatterKey)) {
              this.plugin.settings.defaultFrontmatterKey = nextKeys[0];
            }

            // dropdown を即時追従させる（画面全体は再描画しない）
            this.syncDefaultKeyDropdown(prevDefault);

            await this.plugin.saveSettings();
          });

        t.inputEl.style.width = "100%";
      });

    // Default field dropdown
    new Setting(containerEl)
      .setName("Default field for add/edit")
      .setDesc("Used by the add and reorder modal as the initial target field.")
      .addDropdown((d) => {
        // Obsidian の DropdownComponent の実体 select を保持
        this.defaultKeySelectEl = d.selectEl;

        const keys = this.plugin.settings.frontmatterKeys?.length
          ? this.plugin.settings.frontmatterKeys
          : ["previewLinks"];

        for (const k of keys) d.addOption(k, k);

        const cur = this.plugin.settings.defaultFrontmatterKey;
        d.setValue(keys.includes(cur) ? cur : keys[0]);

        d.onChange(async (v) => {
          this.plugin.settings.defaultFrontmatterKey = v;
          await this.plugin.saveSettings();
        });
      });

    // Open mode
    new Setting(containerEl)
      .setName("Open mode")
      .setDesc("Where to open the Reference Previews view.")
      .addDropdown((d) => {
        d.addOption("reuse", "Reuse existing tab");
        d.addOption("split", "Split next to current");
        d.addOption("tab", "Open in new tab");
        d.setValue(this.plugin.settings.openMode as ReferencePreviewOpenMode);
        d.onChange(async (v) => {
          this.plugin.settings.openMode = v as ReferencePreviewOpenMode;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Auto-open view for active note")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.autoOpen).onChange(async (v) => {
          this.plugin.settings.autoOpen = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Dedupe across fields")
      .setDesc("If enabled, the same link appearing in multiple fields is shown once.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.dedupe).onChange(async (v) => {
          this.plugin.settings.dedupe = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Show field headers")
      .setDesc("If enabled, each frontmatter field is shown as a section header.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.showPropertyHeaders).onChange(async (v) => {
          this.plugin.settings.showPropertyHeaders = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Max items")
      .setDesc("0 = unlimited")
      .addText((t) => {
        t.inputEl.type = "number";
        t.setValue(String(this.plugin.settings.maxItems)).onChange(async (v) => {
          const n = Number(v);
          this.plugin.settings.maxItems = Number.isFinite(n) && n >= 0 ? n : 0;
          await this.plugin.saveSettings();
        });
      });

    // 念のため初期同期
    this.syncDefaultKeyDropdown();
  }
}
