// File: src/reorder-add-modal.ts
import { App, FuzzySuggestModal, Modal, TFile } from "obsidian";

type LinksByKey = Record<string, string[]>;

export class ReorderAndAddModal extends Modal {
  private sourceFile: TFile;
  private keys: string[];
  private currentKey: string;
  private drafts: LinksByKey;
  private onSubmitAll: (drafts: LinksByKey) => void | Promise<void>;

  private keySelectEl!: HTMLSelectElement;
  private headertitleEl!: HTMLElement;
  private listEl!: HTMLElement;

  constructor(
    app: App,
    sourceFile: TFile,
    keys: string[],
    initialKey: string,
    initialByKey: LinksByKey,
    onSubmitAll: (drafts: LinksByKey) => void | Promise<void>
  ) {
    super(app);
    this.sourceFile = sourceFile;
    this.keys = keys.length ? keys : ["previewLinks"];
    this.currentKey = this.keys.includes(initialKey) ? initialKey : this.keys[0];
    this.drafts = { ...initialByKey };
    for (const k of this.keys) {
      if (!Array.isArray(this.drafts[k])) this.drafts[k] = [];
    }
    this.onSubmitAll = onSubmitAll;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const head = contentEl.createEl("div", { cls: "refprev-sort-head" });
    this.headertitleEl = head.createEl("h3", { text: "" });

    const toolbar = contentEl.createEl("div", { cls: "refprev-sort-toolbar" });

    // property select
    const selWrap = toolbar.createEl("div", { cls: "refprev-sort-keywrap" });
    selWrap.createEl("span", { text: "Field:" });
    this.keySelectEl = selWrap.createEl("select");
    for (const k of this.keys) {
      const opt = this.keySelectEl.createEl("option");
      opt.value = k;
      opt.text = k;
    }
    this.keySelectEl.value = this.currentKey;
    this.keySelectEl.addEventListener("change", () => {
      this.saveCurrentToDraft();
      this.currentKey = this.keySelectEl.value;
      this.renderListForCurrentKey();
      this.updateTitle();
    });

    // add buttons
    const addNoteBtn = toolbar.createEl("button", { cls: "refprev-btn", text: "＋ ノート追加" });
    const addUrlBtn = toolbar.createEl("button", { cls: "refprev-btn", text: "＋ URL追加" });

    addNoteBtn.addEventListener("click", () => {
      new FilePickerModal(this.app, (file) => {
        if (!file) return;
        const linkText = this.app.metadataCache.fileToLinktext(file, this.sourceFile.path);
        new SubpathPromptModal(this.app, (subpath) => {
          const sub = subpath
            ? subpath.startsWith("#") || subpath.startsWith("^")
              ? subpath
              : `#${subpath}`
            : "";
          const wiki = `[[${linkText}${sub}]]`;
          this.appendItemToCurrent(wiki);
        }).open();
      }).open();
    });

    addUrlBtn.addEventListener("click", () => {
      new UrlPromptModal(this.app, (url) => {
        if (!url) return;
        this.appendItemToCurrent(url.trim());
      }).open();
    });

    // list
    this.listEl = contentEl.createEl("div", { cls: "refprev-sort-list" });
    this.renderListForCurrentKey();
    this.updateTitle();

    // DnD
    this.listEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      const afterEl = this.getDragAfterElement(this.listEl, e.clientY);
      const dragging = this.listEl.querySelector(".dragging") as HTMLElement | null;
      if (!dragging) return;
      if (afterEl == null) this.listEl.appendChild(dragging);
      else this.listEl.insertBefore(dragging, afterEl);
    });

    const footer = contentEl.createEl("div", { cls: "refprev-sort-footer" });
    const cancel = footer.createEl("button", { text: "キャンセル" });
    const save = footer.createEl("button", { text: "保存", cls: "mod-cta" });

    cancel.addEventListener("click", () => this.close());
    save.addEventListener("click", async () => {
      this.saveCurrentToDraft();
      await this.onSubmitAll(this.drafts);
      this.close();
    });
  }

  private updateTitle() {
    this.headertitleEl.setText(`Edit links (add & reorder): ${this.currentKey}`);
  }

  private renderListForCurrentKey() {
    this.listEl.empty();
    const list = this.drafts[this.currentKey] || [];
    list.forEach((v) => this.addRow(v));
  }

  private saveCurrentToDraft() {
    const newOrder: string[] = [];
    this.listEl.querySelectorAll<HTMLElement>(".refprev-sort-item").forEach((el) => {
      newOrder.push(el.getAttribute("data-value") || "");
    });
    this.drafts[this.currentKey] = newOrder;
  }

  private appendItemToCurrent(val: string) {
    this.saveCurrentToDraft();
    const list = this.drafts[this.currentKey] || [];
    list.push(val);
    this.drafts[this.currentKey] = list;
    this.listEl.empty();
    list.forEach((v) => this.addRow(v));
  }

  private addRow(val: string) {
    const row = this.listEl.createEl("div", {
      cls: "refprev-sort-item",
      attr: { draggable: "true", "data-value": val },
    });

    row.createEl("span", { cls: "refprev-sort-handle", text: "⇅" });
    row.createEl("span", { cls: "refprev-sort-label", text: val });

    const remove = row.createEl("button", { cls: "refprev-sort-remove", text: "×" });

    row.addEventListener("dragstart", () => row.addClass("dragging"));
    row.addEventListener("dragend", () => row.removeClass("dragging"));

    row.tabIndex = 0;
    row.addEventListener("keydown", (e) => {
      const siblings = Array.from(this.listEl.querySelectorAll<HTMLElement>(".refprev-sort-item"));
      const idx = siblings.indexOf(row);
      if (e.key === "ArrowUp" && idx > 0) {
        e.preventDefault();
        this.listEl.insertBefore(row, siblings[idx - 1]);
      } else if (e.key === "ArrowDown" && idx < siblings.length - 1) {
        e.preventDefault();
        this.listEl.insertBefore(row, siblings[idx + 1].nextSibling);
      }
    });

    remove.addEventListener("click", () => row.remove());
  }

  private getDragAfterElement(container: Element, y: number): HTMLElement | null {
    const els = Array.from(container.querySelectorAll<HTMLElement>(".refprev-sort-item:not(.dragging)"));
    return els.reduce<{ offset: number; el: HTMLElement | null }>(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
          return { offset, el: child };
        } else {
          return closest;
        }
      },
      { offset: Number.NEGATIVE_INFINITY, el: null }
    ).el;
  }

  onClose() {
    this.contentEl.empty();
  }
}

class FilePickerModal extends FuzzySuggestModal<TFile> {
  private onChoose: (file: TFile | null) => void;
  private picked = false;

  constructor(app: App, onChoose: (file: TFile | null) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("ノート名を検索…");
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile, _evt: MouseEvent | KeyboardEvent) {
    this.picked = true;
    this.onChoose(item);
  }

  onClose() {
    if (!this.picked) this.onChoose(null);
  }
}

class SubpathPromptModal extends Modal {
  private onSubmit: (subpath: string) => void;

  constructor(app: App, onSubmit: (subpath: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "サブパス（任意）" });
    contentEl.createEl("p", { text: "例）#見出し名  または  ^abc123  / 空のままでもOK" });

    const input = contentEl.createEl("input", { type: "text" });
    input.placeholder = "#Heading  または  ^blockid";
    input.focus();

    const footer = contentEl.createEl("div", { cls: "refprev-sort-footer" });
    const skip = footer.createEl("button", { text: "スキップ" });
    const ok = footer.createEl("button", { text: "OK", cls: "mod-cta" });

    skip.addEventListener("click", () => {
      this.onSubmit("");
      this.close();
    });
    ok.addEventListener("click", () => {
      this.onSubmit(input.value.trim());
      this.close();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.onSubmit(input.value.trim());
        this.close();
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class UrlPromptModal extends Modal {
  private onSubmit: (url: string | null) => void;

  constructor(app: App, onSubmit: (url: string | null) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "URL を追加" });

    const input = contentEl.createEl("input", { type: "text" });
    input.placeholder = "https://example.com";
    input.focus();

    const footer = contentEl.createEl("div", { cls: "refprev-sort-footer" });
    const cancel = footer.createEl("button", { text: "キャンセル" });
    const ok = footer.createEl("button", { text: "追加", cls: "mod-cta" });

    cancel.addEventListener("click", () => {
      this.onSubmit(null);
      this.close();
    });
    ok.addEventListener("click", () => {
      this.onSubmit(input.value.trim());
      this.close();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.onSubmit(input.value.trim());
        this.close();
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
