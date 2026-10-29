import { setIcon } from "obsidian";
import type { LogRecord, PlaceRecord } from "../types";
import { createButton } from "./dom";

export interface MapLogPanelOptions {
  logs: LogRecord[];
  places?: PlaceRecord[];
  onOpenLog: (logId: string) => void;
  onNewLog?: (placeId?: string) => void;
  onNewTrip?: () => void;
  onOpenPlace?: (placeId: string) => void;
  onClose?: () => void;
}

function logDate(log: LogRecord): string {
  return log.visitedStart ?? log.date ?? "未写日期";
}

function excerptOf(log: LogRecord): string {
  return log.tags.length > 0 ? log.tags.slice(0, 4).join(" · ") : "旅行日志";
}

/**
 * A floating map log panel shared by the offline Leaflet map and the AMap view.
 * Place chips filter the list; new-log/new-trip actions are explicit buttons.
 */
export function showMapLogPanel(
  host: HTMLElement,
  title: string,
  options: MapLogPanelOptions
): HTMLElement {
  clearMapLogPanel(host);
  const panel = host.createDiv({ cls: "travel-map-log-panel" });
  const header = panel.createDiv({ cls: "travel-map-log-panel__head" });
  const heading = header.createDiv({ cls: "travel-map-log-panel__title", text: title });
  heading.setAttribute("title", title);
  const close = header.createEl("button", {
    cls: "travel-map-log-panel__close",
    attr: { type: "button", "aria-label": "关闭日志面板" },
  });
  setIcon(close, "x");
  close.addEventListener("click", () => {
    panel.remove();
    options.onClose?.();
  });
  makeLogPanelDraggable(host, panel, header);

  const meta = panel.createDiv({ cls: "travel-map-log-panel__meta" });
  let selectedPlaceId: string | null = null;
  const selectedPlace = () =>
    selectedPlaceId
      ? options.places?.find((place) => place.id === selectedPlaceId) ?? null
      : null;

  const list = panel.createDiv({ cls: "travel-map-log-panel__list" });

  const renderMeta = (count: number) => {
    const place = selectedPlace();
    meta.setText(
      place
        ? `${count} 篇日志 · ${place.name}`
        : `${count} 篇日志${options.places?.length ? ` · ${options.places.length} 个地点` : ""}`
    );
  };

  const renderList = () => {
    list.empty();
    const visible = selectedPlaceId
      ? options.logs.filter((log) => log.placeId === selectedPlaceId)
      : options.logs;
    renderMeta(visible.length);
    if (visible.length === 0) {
      list.createDiv({
        cls: "travel-empty__hint",
        text: selectedPlaceId ? "这个地点还没有旅行日志。" : "这个区域还没有旅行日志。",
      });
      return;
    }
    for (const log of visible) {
      const item = list.createEl("button", {
        cls: "travel-map-log-item",
        attr: { type: "button" },
      });
      item.createDiv({ cls: "travel-map-log-item__date", text: logDate(log) });
      item.createDiv({ cls: "travel-map-log-item__title", text: log.title });
      item.createDiv({ cls: "travel-map-log-item__meta", text: excerptOf(log) });
      item.addEventListener("click", () => options.onOpenLog(log.id));
    }
  };

  if (options.places && options.places.length > 0) {
    const placeRow = panel.createDiv({ cls: "travel-map-log-panel__places" });
    const chips: Array<{ button: HTMLButtonElement; placeId: string | null }> = [];
    const addChip = (label: string, placeId: string | null) => {
      const button = placeRow.createEl("button", {
        cls: "travel-chip travel-chip--city",
        text: label,
        attr: { type: "button" },
      });
      chips.push({ button, placeId });
      button.addEventListener("click", () => {
        selectedPlaceId = placeId;
        for (const chip of chips) {
          chip.button.toggleClass("is-active", chip.placeId === selectedPlaceId);
        }
        renderList();
      });
    };
    addChip("全部", null);
    for (const place of options.places.slice(0, 16)) {
      addChip(place.name, place.id);
    }
    chips[0]?.button.addClass("is-active");
  }

  if (options.onNewLog || options.onNewTrip || options.onOpenPlace) {
    const actions = panel.createDiv({ cls: "travel-map-log-panel__actions" });
    if (options.onNewLog) {
      createButton(
        actions,
        "新建日志",
        () => options.onNewLog?.(selectedPlaceId ?? undefined),
        { cta: true, icon: "pen-line" }
      );
    }
    if (options.onNewTrip) {
      createButton(actions, "新建行程", () => options.onNewTrip?.(), {
        icon: "route",
      });
    }
    if (options.onOpenPlace) {
      const place = selectedPlace();
      if (place) {
        createButton(actions, "地点档案", () => options.onOpenPlace?.(place.id), {
          icon: "file-text",
        });
      }
    }
  }

  renderList();
  return panel;
}

export function clearMapLogPanel(host: HTMLElement): void {
  host.querySelector(".travel-map-log-panel")?.remove();
}

function makeLogPanelDraggable(
  host: HTMLElement,
  panel: HTMLElement,
  handle: HTMLElement
): void {
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  const move = (event: PointerEvent) => {
    const hostRect = host.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(0, hostRect.width - rect.width);
    const maxTop = Math.max(0, hostRect.height - rect.height);
    panel.style.left = `${Math.max(0, Math.min(maxLeft, startLeft + event.clientX - startX))}px`;
    panel.style.top = `${Math.max(0, Math.min(maxTop, startTop + event.clientY - startY))}px`;
  };
  const end = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    panel.removeClass("is-dragging");
  };
  handle.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const hostRect = host.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left - hostRect.left;
    startTop = rect.top - hostRect.top;
    panel.style.left = `${startLeft}px`;
    panel.style.top = `${startTop}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.addClass("is-dragging");
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });
}
