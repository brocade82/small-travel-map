import { Modal, Notice } from "obsidian";
import type TravelMapPlugin from "../../main";
import type { SelfCheckReport } from "../../services/self-check";
import { createButton, errorText } from "../dom";

const SEVERITY_LABEL = {
  error: "错误",
  warning: "警告",
  info: "提示",
} as const;

export class SelfCheckModal extends Modal {
  private report: SelfCheckReport | null = null;
  private error: string | null = null;
  private running = false;

  constructor(private readonly plugin: TravelMapPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    this.modalEl.addClass("travel-modal");
    this.titleEl.setText("旅游数据自检");
    void this.load();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async load(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.contentEl.empty();
    this.contentEl.createDiv({ cls: "travel-empty__hint", text: "正在扫描索引、链接和库外媒体…" });
    try {
      this.report = await this.plugin.selfCheck.run();
      this.error = null;
      this.render();
    } catch (error) {
      this.error = errorText(error);
      this.render();
    } finally {
      this.running = false;
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText("旅游数据自检");

    if (this.error) {
      contentEl.createDiv({ cls: "travel-warning", text: `自检失败：${this.error}` });
      const actions = contentEl.createDiv({ cls: "travel-modal__actions" });
      createButton(actions, "重试", () => void this.load(), { cta: true });
      createButton(actions, "关闭", () => this.close());
      return;
    }
    if (!this.report) return;

    const report = this.report;
    const summary = contentEl.createDiv({ cls: "travel-stats" });
    for (const [label, value, hint] of [
      ["地点档案", String(report.counts.places), "kind: place"],
      ["旅行日志", String(report.counts.logs), "kind: travel-log"],
      ["行程", String(report.counts.trips), "kind: trip"],
      ["普通笔记", String(report.counts.legacy), "只读兼容"],
    ] as const) {
      const card = summary.createDiv({ cls: "travel-stat" });
      card.createDiv({ cls: "travel-stat__value", text: value });
      card.createDiv({ cls: "travel-stat__label", text: label });
      card.createDiv({ cls: "travel-stat__hint", text: hint });
    }

    const stats = contentEl.createDiv({ cls: "travel-check-stats" });
    stats.createDiv({
      cls: "travel-empty__hint",
      text:
        `库外视频链接 ${report.stats.videoLinks} 个；缺失 ${report.stats.missingVideos} 个；` +
        `无 adcode 地点 ${report.stats.placesWithoutAdcode} 个；未知 adcode ${report.stats.unknownAdcodes} 个；` +
        `港澳台地点 ${report.stats.unsupportedRegions} 个；缺失封面 ${report.stats.missingCovers} 个。`,
    });

    const errors = report.issues.filter((issue) => issue.severity === "error");
    const warnings = report.issues.filter((issue) => issue.severity === "warning");
    const infos = report.issues.filter((issue) => issue.severity === "info");
    contentEl.createDiv({
      cls: "travel-modal__subtitle",
      text: `生成于 ${report.generatedAt} · 错误 ${errors.length} · 警告 ${warnings.length} · 提示 ${infos.length}`,
    });

    if (report.issues.length === 0) {
      contentEl.createDiv({
        cls: "travel-empty__hint",
        text: "没有发现问题。ID、adcode、关联链接和库外视频都存在。",
      });
    } else {
      const list = contentEl.createDiv({ cls: "travel-check-list" });
      for (const issue of report.issues) {
        const item = list.createDiv({ cls: `travel-check-item is-${issue.severity}` });
        const head = item.createDiv({ cls: "travel-check-item__head" });
        head.createSpan({
          cls: "travel-check-item__severity",
          text: SEVERITY_LABEL[issue.severity],
        });
        head.createSpan({ cls: "travel-check-item__category", text: issue.category });
        item.createDiv({ cls: "travel-check-item__message", text: issue.message });
        if (issue.path) {
          item.createDiv({ cls: "travel-check-item__path", text: issue.path });
        }
      }
    }

    const actions = contentEl.createDiv({ cls: "travel-modal__actions" });
    createButton(actions, "重新检查", () => void this.load(), { icon: "refresh-cw" });
    createButton(actions, "复制报告", () => {
      const text = [
        `旅游数据自检 ${report.generatedAt}`,
        `地点 ${report.counts.places} / 日志 ${report.counts.logs} / 行程 ${report.counts.trips} / 普通笔记 ${report.counts.legacy}`,
        ...report.issues.map(
          (issue) =>
            `[${SEVERITY_LABEL[issue.severity]}] ${issue.category}：${issue.message}${
              issue.path ? `（${issue.path}）` : ""
            }`
        ),
      ].join("\n");
      if (!navigator.clipboard?.writeText) {
        new Notice("当前环境不能写入剪贴板，请手动选择文本");
        return;
      }
      void navigator.clipboard.writeText(text).then(
        () => new Notice("自检报告已复制"),
        () => new Notice("复制失败，请手动选择文本")
      );
    }, { icon: "copy" });
    createButton(actions, "关闭", () => this.close(), { cta: true });
  }
}
