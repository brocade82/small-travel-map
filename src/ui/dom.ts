import { setIcon } from "obsidian";

export type BannerKind = "info" | "success" | "warning" | "error";

export interface ButtonOptions {
  cta?: boolean;
  icon?: string;
  cls?: string;
  title?: string;
}

export function createButton(
  parent: HTMLElement,
  label: string,
  onClick: (event: MouseEvent) => void,
  options: ButtonOptions = {}
): HTMLButtonElement {
  const classes = ["travel-button"];
  if (options.cta) classes.push("mod-cta");
  if (options.cls) classes.push(options.cls);
  const button = parent.createEl("button", { cls: classes.join(" "), text: label });
  button.type = "button";
  if (options.title) button.title = options.title;
  if (options.icon) {
    const icon = button.createSpan({ cls: "travel-button__icon" });
    setIcon(icon, options.icon);
  }
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onClick(event);
  });
  return button;
}

export function createIconButton(
  parent: HTMLElement,
  icon: string,
  label: string,
  onClick: (event: MouseEvent) => void
): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: "travel-icon-button",
    attr: { "aria-label": label, title: label },
  });
  button.type = "button";
  setIcon(button, icon);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onClick(event);
  });
  return button;
}

export function createBanner(
  parent: HTMLElement,
  kind: BannerKind,
  message: string,
  actions: Array<{ label: string; onClick: () => void; cta?: boolean }> = []
): HTMLElement {
  const banner = parent.createDiv({ cls: `travel-banner travel-banner--${kind}` });
  banner.createDiv({ cls: "travel-banner__text", text: message });
  if (actions.length > 0) {
    const row = banner.createDiv({ cls: "travel-banner__actions" });
    for (const action of actions) {
      createButton(row, action.label, action.onClick, { cta: action.cta });
    }
  }
  return banner;
}

export function createEmptyState(
  parent: HTMLElement,
  icon: string,
  title: string,
  hint: string
): HTMLElement {
  const empty = parent.createDiv({ cls: "travel-empty" });
  const iconEl = empty.createDiv({ cls: "travel-empty__icon" });
  setIcon(iconEl, icon);
  empty.createDiv({ cls: "travel-empty__title", text: title });
  empty.createDiv({ cls: "travel-empty__hint", text: hint });
  return empty;
}

export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "未知错误";
}

export function formatQuotaText(snapshot: {
  sessionCount: number;
  sessionLimit: number;
  dayCount: number;
  monthCount: number;
}): string {
  return `本会话 ${snapshot.sessionCount}/${snapshot.sessionLimit} · 今日 ${snapshot.dayCount} · 本月 ${snapshot.monthCount}`;
}

export function chipLabel(name: string): string {
  return name.replace(/(省|市|自治区|特别行政区)$/u, "");
}
