import { FuzzySuggestModal, Modal, Notice, TFolder } from "obsidian";
import type TravelMapPlugin from "../../main";
import type { ImportPlan, ImportResult, SkipReason } from "../../services/import-service";
import { inventorySummary } from "../../core/import";
import { createButton, errorText } from "../dom";

export class ImportFolderModal extends FuzzySuggestModal<TFolder> {
  constructor(private readonly plugin: TravelMapPlugin) {
    super(plugin.app);
    this.setPlaceholder("选择要导入的旧笔记文件夹…");
  }

  getItems(): TFolder[] {
    return this.plugin.app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder)
      .filter((folder) => folder.path !== this.plugin.repo.baseFolder())
      .sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
  }

  getItemText(item: TFolder): string {
    return item.path || "/";
  }

  onChooseItem(item: TFolder): void {
    void startImport(this.plugin, item.path);
  }
}

export async function startImport(plugin: TravelMapPlugin, folderPath: string): Promise<void> {
  const notice = new Notice("正在扫描旧笔记…", 0);
  try {
    const plan = await plugin.importer.scan(folderPath);
    notice.hide();
    new ImportReportModal(plugin, plan).open();
  } catch (error) {
    notice.hide();
    new Notice(`扫描失败：${errorText(error)}`);
  }
}

export async function startExternalImport(
  plugin: TravelMapPlugin,
  folderPath: string
): Promise<void> {
  const notice = new Notice("正在扫描外部文件夹…", 0);
  try {
    const plan = await plugin.importer.scanExternal(folderPath);
    notice.hide();
    new ImportReportModal(plugin, plan).open();
  } catch (error) {
    notice.hide();
    new Notice(`扫描失败：${errorText(error)}`);
  }
}

export class ImportExternalModal extends Modal {
  private input!: HTMLInputElement;
  private scanning = false;

  constructor(private readonly plugin: TravelMapPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    this.modalEl.addClass("travel-modal");
    this.titleEl.setText("导入外部文件夹");
    this.contentEl.createDiv({
      cls: "travel-modal__subtitle",
      text:
        "填写 Vault 外的绝对路径，例如 D:\\TravelMedia。只读扫描，不会复制或移动任何文件；" +
        "确认后只把 Markdown / TXT 笔记复制进 旅游/日志。",
    });
    this.input = this.contentEl.createEl("input", {
      type: "text",
      cls: "travel-input",
      attr: { placeholder: "D:\\TravelMedia" },
    });
    const actions = this.contentEl.createDiv({ cls: "travel-modal__actions" });
    createButton(
      actions,
      this.scanning ? "扫描中…" : "扫描并查看报告",
      () => void this.scan(),
      { cta: true, icon: "search" }
    );
    createButton(actions, "取消", () => this.close());
    window.setTimeout(() => this.input.focus(), 30);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async scan(): Promise<void> {
    if (this.scanning) return;
    const folder = this.input.value.trim();
    if (!folder) {
      new Notice("请填写外部文件夹的绝对路径");
      return;
    }
    this.scanning = true;
    try {
      this.close();
      await startExternalImport(this.plugin, folder);
    } finally {
      this.scanning = false;
    }
  }
}

export class ImportReportModal extends Modal {
  private result: ImportResult | null = null;
  private running = false;

  constructor(
    private readonly plugin: TravelMapPlugin,
    private readonly plan: ImportPlan
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.modalEl.addClass("travel-modal");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText("导入旧笔记 · 先看报告");
    contentEl.createDiv({
      cls: "travel-modal__subtitle",
      text: `来源：${this.plan.rootPath}${this.plan.external ? "（外部）" : ""}。复制不移动，正文不改，已导入的不会重复。`,
    });
    contentEl.createDiv({
      cls: "travel-empty__hint",
      text: `文件构成：${inventorySummary(this.plan.inventory)}`,
    });
    const mediaCount =
      this.plan.inventory.images +
      this.plan.inventory.videos +
      this.plan.inventory.documents +
      this.plan.inventory.other;
    if (mediaCount > 0) {
      contentEl.createDiv({
        cls: "travel-warning",
        text:
          `发现 ${mediaCount} 个媒体/其他文档。它们不会被复制或移动；本次只导入 .md / .txt 笔记，` +
          "原文件夹请保留。",
      });
    }

    const skipCounts = new Map<SkipReason, number>();
    for (const skipped of this.plan.skipped) {
      skipCounts.set(skipped.reason, (skipCounts.get(skipped.reason) ?? 0) + 1);
    }

    const summary = contentEl.createDiv({ cls: "travel-import-summary" });
    this.summaryItem(summary, "扫描文件", this.plan.totalFiles);
    this.summaryItem(summary, "可导入", this.plan.candidates.length);
    this.summaryItem(summary, "缺地点", this.plan.missingPlace);
    this.summaryItem(summary, "日期靠推测", this.plan.missingDate);
    this.summaryItem(summary, "目标重名", this.plan.existingCollisions);

    if (this.plan.candidates.length === 0) {
      contentEl.createDiv({
        cls: "travel-empty__hint",
        text:
          "没有可导入的笔记。当前只导入 .md / .txt；已带 kind 的笔记会被视为已管理，" +
          "之前导入过的会按 source 跳过。",
      });
    } else {
      const list = contentEl.createDiv({ cls: "travel-import-list" });
      for (const candidate of this.plan.candidates.slice(0, 80)) {
        const row = list.createDiv({ cls: "travel-import-row" });
        row.createDiv({ cls: "travel-import-row__date", text: candidate.date });
        const main = row.createDiv({ cls: "travel-import-row__main" });
        main.createDiv({ cls: "travel-import-row__title", text: candidate.name });
        main.createDiv({
          cls: "travel-import-row__source",
          text: candidate.sourcePath,
        });
        main.createDiv({
          cls: "travel-import-row__meta",
          text: `${candidate.sourceType === "text" ? "TXT" : "Markdown"} · ${
            candidate.placeId ? "可关联地点" : "缺地点，导入后可手动关联"
          }`,
        });
      }
      if (this.plan.candidates.length > 80) {
        contentEl.createDiv({
          cls: "travel-empty__hint",
          text: `还有 ${this.plan.candidates.length - 80} 篇未展开显示。`,
        });
      }
    }

    if (skipCounts.size > 0) {
      const details = contentEl.createEl("details", { cls: "travel-import-skipped" });
      details.createEl("summary", {
        text: `跳过 ${this.plan.skipped.length} 个文件（点击展开）`,
      });
      for (const [reason, count] of skipCounts) {
        details.createDiv({
          cls: "travel-import-skipped__line",
          text: `${reason}：${count} 个（${this.plan.skipped.find((item) => item.reason === reason)?.detail ?? ""}）`,
        });
      }
      const list = details.createDiv({ cls: "travel-import-skipped__list" });
      for (const skipped of this.plan.skipped.slice(0, 100)) {
        list.createDiv({ cls: "travel-import-skipped__item", text: skipped.path });
      }
    }

    if (this.result) {
      const result = contentEl.createDiv({ cls: "travel-import-result" });
      result.createDiv({
        cls: "travel-modal__section-title",
        text: `导入完成：创建 ${this.result.created} 篇，跳过 ${this.result.skipped} 篇，错误 ${this.result.errors.length} 个`,
      });
      for (const error of this.result.errors) {
        result.createDiv({
          cls: "travel-warning",
          text: `${error.path}：${error.message}`,
        });
      }
    }

    const actions = contentEl.createDiv({ cls: "travel-modal__actions" });
    if (this.result) {
      createButton(actions, "关闭", () => this.close(), { cta: true });
    } else {
      createButton(
        actions,
        this.running ? "正在导入…" : `开始导入 ${this.plan.candidates.length} 篇`,
        () => void this.execute(),
        { cta: true, icon: "download" }
      );
      createButton(actions, "取消", () => this.close());
    }
  }

  private summaryItem(parent: HTMLElement, label: string, value: number): void {
    const item = parent.createDiv({ cls: "travel-import-summary__item" });
    item.createDiv({ cls: "travel-import-summary__value", text: String(value) });
    item.createDiv({ cls: "travel-import-summary__label", text: label });
  }

  private async execute(): Promise<void> {
    if (this.running || this.plan.candidates.length === 0) return;
    this.running = true;
    try {
      this.result = await this.plugin.importer.execute(this.plan);
      new Notice(
        `导入完成：创建 ${this.result.created} 篇，跳过 ${this.result.skipped} 篇`
      );
      this.render();
      this.plugin.refreshOpenViews();
    } catch (error) {
      new Notice(`导入失败：${errorText(error)}`);
    } finally {
      this.running = false;
    }
  }
}
