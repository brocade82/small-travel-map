import { FuzzySuggestModal, Notice } from "obsidian";
import type TravelMapPlugin from "../../main";
import type { PlaceRecord } from "../../types";
import { formatRegionPath } from "../../core/regions";
import { JournalModal } from "./journal-modal";

export class PlacePickerModal extends FuzzySuggestModal<PlaceRecord> {
  constructor(private readonly plugin: TravelMapPlugin) {
    super(plugin.app);
    this.setPlaceholder("选择地点，或输入名称搜索…");
  }

  getItems(): PlaceRecord[] {
    return [...this.plugin.index.getPlaces()].sort((a, b) =>
      a.name.localeCompare(b.name, "zh-Hans-CN")
    );
  }

  getItemText(item: PlaceRecord): string {
    const region = formatRegionPath(item.province, item.city, item.district);
    return region ? `${item.name} · ${region}` : item.name;
  }

  onChooseItem(item: PlaceRecord): void {
    new JournalModal(this.plugin, item.id).open();
  }
}

export function pickPlaceForJournal(plugin: TravelMapPlugin): void {
  const places = plugin.index.getPlaces();
  if (places.length === 0) {
    new Notice("还没有地点档案。先搜索并保存一个地点。", 5000);
    plugin.openMap("overview");
    return;
  }
  new PlacePickerModal(plugin).open();
}
