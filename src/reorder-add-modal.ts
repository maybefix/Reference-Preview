import {
  App,
  FuzzySuggestModal,
  Modal,
  TFile,
} from "obsidian";

export class ReorderAndAddModal extends Modal {
  private sourceFile: TFile;
  private items: string[];
  private onSubmit: (newOrder: string[]) => void;
  private listEl!: HTMLElement;

  constructor(app: App, sourceFile: TFile, items: string[], onSubmit: (newOrder: string[]) => void) {
    super(app);
    this.sourceFile = sourceFile;
    this.items = items.slice(); // 作業用コピー
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Edit previewLinks (add & reorder)" });
    const toolbar = contentEl.createEl("div", { cls: "refprev-sort-toolbar" });

    // 追加ボタン群
    const addNoteBtn = toolbar.createEl("button", { cls: "refprev-btn", text: "＋ ノート追加" });
    const addUrlBtn  = toolbar.createEl("button", { cls: "refprev-btn", text: "＋ URL追加" });

    addNoteBtn.addEventListener("click", () => {
      new FilePickerModal(this.app, (file) => {
        if (!file) return;
        // 相対リンクテキスト（拡張子なし・相対パスを Obsidian 流儀で）
        const linkText = this.app.metadataCache.fileToLinktext(file, this.sourceFile.path);
        // サブパス入力（任意）
        new SubpathPromptModal(this.app, (subpath) => {
          const sub = subpath ? (subpath.startsWith("#") || subpath.startsWith("^") ? subpath : `#${subpath}`) : "";
          const wiki = `[[${linkText}${sub}]]`;
          this.appendItem(wiki);
        }).open();
      }).open();
    });

    addUrlBtn.addEventListener("click", () => {
      new UrlPromptModal(this.app, (url) => {
        if (!url) return;
        this.appendItem(url.trim());
      }).open();
    });

    // 並べ替えリスト
    this.listEl = contentEl.createEl("div", { cls: "refprev-sort-list" });
    this.renderList();

    // DnD（HTML5）
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
    const save   = footer.createEl("button", { text: "保存", cls: "mod-cta" });

    cancel.addEventListener("click", () => this.close());
    save.addEventListener("click", () => {
      const newOrder: string[] = [];
      this.listEl.querySelectorAll<HTMLElement>(".refprev-sort-item").forEach((el) => {
        newOrder.push(el.getAttribute("data-value") || "");
      });
      this.onSubmit(newOrder);
      this.close();
    });
  }

  private renderList() {
    this.listEl.empty();
    this.items.forEach((val) => this.addRow(val));
  }

  private appendItem(val: string) {
    this.items.push(val);
    this.addRow(val);
  }

  private addRow(val: string) {
    const row = this.listEl.createEl("div", {
      cls: "refprev-sort-item",
      attr: { draggable: "true", "data-value": val },
    });

    const handle = row.createEl("span", { cls: "refprev-sort-handle", text: "⇅" });
    const label  = row.createEl("span", { cls: "refprev-sort-label", text: val });
    const remove = row.createEl("button", { cls: "refprev-sort-remove", text: "×" });

    row.addEventListener("dragstart", () => row.addClass("dragging"));
    row.addEventListener("dragend", () => row.removeClass("dragging"));

    // キーボードでの上下移動（↑/↓）
    row.tabIndex = 0;
    row.addEventListener("keydown", (e) => {
      const siblings = Array.from(this.listEl.querySelectorAll(".refprev-sort-item"));
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
    const els = Array.from(
      container.querySelectorAll<HTMLElement>(".refprev-sort-item:not(.dragging)")
    );
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

/** Vault 内の Markdown ファイルを Obsidian 標準のファジーで選択 */
class FilePickerModal extends FuzzySuggestModal<TFile> {
  private onChoose: (file: TFile | null) => void;
  private picked = false; // ← これで選択済みかどうかを管理

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
    // 何も選ばずに閉じられた場合のみ null を返す
    if (!this.picked) this.onChoose(null);
  }
}

/** サブパス（#見出し / ^blockid）を任意入力する簡易モーダル */
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
    const ok   = footer.createEl("button", { text: "OK", cls: "mod-cta" });

    skip.addEventListener("click", () => { this.onSubmit(""); this.close(); });
    ok.addEventListener("click", () => { this.onSubmit(input.value.trim()); this.close(); });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { this.onSubmit(input.value.trim()); this.close(); }
    });
  }

  onClose() { this.contentEl.empty(); }
}

/** URL 入力用のミニモーダル */
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
    const ok     = footer.createEl("button", { text: "追加", cls: "mod-cta" });

    cancel.addEventListener("click", () => { this.onSubmit(null); this.close(); });
    ok.addEventListener("click", () => { this.onSubmit(input.value.trim()); this.close(); });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { this.onSubmit(input.value.trim()); this.close(); }
    });
  }

  onClose() { this.contentEl.empty(); }
}
