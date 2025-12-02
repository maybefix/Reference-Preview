// File: src/settings.ts
import { App, PluginSettingTab, Setting } from "obsidian";
import type ReferencePreviewPlugin from "./main";

export interface ReferencePreviewSettings {
  frontmatterKey: string;
  autoOpen: boolean;
  splitAdjacent: boolean;
  maxItems: number; // 0 = unlimited
}

export const DEFAULT_SETTINGS: ReferencePreviewSettings = {
  frontmatterKey: "previewLinks",
  autoOpen: true,
  splitAdjacent: true,
  maxItems: 0,
};

export class ReferencePreviewSettingTab extends PluginSettingTab {
  plugin: ReferencePreviewPlugin;

  constructor(app: App, plugin: ReferencePreviewPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Reference Previews" });

    // Frontmatter field
    new Setting(containerEl)
      .setName("Frontmatter field")
      .setDesc(
        "YAML key to read links from. Accepts a YAML list or a comma/line-separated string."
      )
      .addText((t) => {
        t.setPlaceholder("previewLinks")
          .setValue(this.plugin.settings.frontmatterKey)
          .onChange(async (v) => {
            this.plugin.settings.frontmatterKey = v.trim() || "previewLinks";
            await this.plugin.saveSettings();
          });
      });

    // Auto-open
    new Setting(containerEl)
      .setName("Auto-open view for active note")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.autoOpen).onChange(async (v) => {
          this.plugin.settings.autoOpen = v;
          await this.plugin.saveSettings();
        });
      });

    // Open next to current pane
    new Setting(containerEl)
      .setName("Open next to current pane")
      .setDesc("Use adjacent split if available when opening the view.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.splitAdjacent).onChange(async (v) => {
          this.plugin.settings.splitAdjacent = v;
          await this.plugin.saveSettings();
        });
      });

    // Max items
    new Setting(containerEl)
      .setName("Max items")
      .setDesc("0 = unlimited")
      .addText((t) => {
        // 数値入力にする
        t.inputEl.type = "number";
        t.setValue(String(this.plugin.settings.maxItems)).onChange(
          async (v) => {
            const n = Number(v);
            this.plugin.settings.maxItems =
              Number.isFinite(n) && n >= 0 ? n : 0;
            await this.plugin.saveSettings();
          }
        );
      });
  }
}
