import { FuzzySuggestModal, MarkdownView, Notice } from "obsidian";
import type TravelMapPlugin from "../../main";
import type { MediaEntry } from "../../services/media-manifest";
import {
  buildPhotoEmbed,
  buildVideoLink,
  formatBytes,
  humanMediaLabel,
} from "../../core/media";

/**
 * Lists the user's original photos and videos from the configured media root.
 * Selection inserts an absolute `local-file:///` link (or hands the entry to a
 * caller such as the journal cover field).
 */
export class MediaPickerModal extends FuzzySuggestModal<MediaEntry> {
  constructor(
    private readonly plugin: TravelMapPlugin,
    private readonly entries: MediaEntry[],
    private readonly onSelect?: (entry: MediaEntry) => void
  ) {
    super(plugin.app);
    this.setPlaceholder("搜索库外照片/视频…");
  }

  getItems(): MediaEntry[] {
    return this.entries;
  }

  getItemText(item: MediaEntry): string {
    const kind = item.kind === "photo" ? "照片" : "视频";
    return `${kind} · ${item.relativePath} · ${formatBytes(item.size)}`;
  }

  onChooseItem(item: MediaEntry): void {
    if (this.onSelect) {
      this.onSelect(item);
      return;
    }
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("请先打开一篇 Markdown 笔记，再插入库外媒体。");
      return;
    }
    const label = humanMediaLabel(item.relativePath);
    const options = {
      mediaRoot: this.plugin.settings.mediaRoot,
      mode: this.plugin.settings.mediaLinkMode,
    };
    const link =
      item.kind === "photo"
        ? buildPhotoEmbed(item.relativePath, { ...options, label })
        : buildVideoLink(item.relativePath, { ...options, label: `▶ ${label}` });
    view.editor.replaceSelection(link);
    new Notice(
      `已插入${item.kind === "photo" ? "照片" : "视频"}绝对链接：${item.relativePath}`
    );
  }
}

/** Video-only entry point retained for the existing command. */
export class VideoPickerModal extends MediaPickerModal {
  constructor(plugin: TravelMapPlugin, entries: MediaEntry[]) {
    super(plugin, entries.filter((entry) => entry.kind === "video"));
    this.setPlaceholder("搜索库外视频文件…");
  }
}
