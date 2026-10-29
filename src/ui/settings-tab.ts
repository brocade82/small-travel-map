import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type TravelMapPlugin from "../main";
import { createButton } from "./dom";
import { SelfCheckModal } from "./modals/self-check-modal";
import { ImportFolderModal } from "./modals/import-modal";

export class TravelMapSettingTab extends PluginSettingTab {
  private keyStatusEl: HTMLElement | null = null;
  private quotaEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly plugin: TravelMapPlugin
  ) {
    super(app, plugin);
  }

  private addMapColorSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    key: "mapProvinceColor" | "mapCityColor" | "mapCountyColor" | "mapPlaceColor"
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        text.inputEl.type = "color";
        text.inputEl.addClass("travel-color-input");
        text
          .setValue(this.plugin.settings[key])
          .onChange(async (value) => {
            if (!/^#[0-9a-f]{6}$/i.test(value)) return;
            this.plugin.settings[key] = value.toLowerCase();
            await this.plugin.saveSettings();
          });
      });
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("travel-settings");

    new Setting(containerEl)
      .setName("数据位置")
      .setDesc("旅行笔记、地点档案都放在 Vault 内；照片和视频可留在库外媒体根目录，通过 DLink 绝对路径显示/播放。")
      .setHeading();

    new Setting(containerEl)
      .setName("旅游目录")
      .setDesc("相对 Vault 根目录，默认 旅游。地点、日志、行程、媒体都放在这里。")
      .addText((text) => {
        text
          .setPlaceholder("旅游")
          .setValue(this.plugin.settings.baseFolder)
          .onChange(async (value) => {
            this.plugin.settings.baseFolder = value.trim() || "旅游";
            await this.plugin.saveSettings();
          });
        text.inputEl.addEventListener("blur", () => {
          void this.plugin.reindex();
        });
      });

    new Setting(containerEl)
      .setName("媒体根目录（照片 / 视频）")
      .setDesc(
        "库外绝对路径，用户的原始照片和视频都放这里。插件只读取、不复制、不转码；" +
          "照片和视频通过 local-file:/// 绝对路径交给 DLink 显示/播放。"
      )
      .addText((text) => {
        text
          .setPlaceholder("D:\\TravelMedia")
          .setValue(this.plugin.settings.mediaRoot)
          .onChange(async (value) => {
            this.plugin.settings.mediaRoot = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("库外媒体链接写法")
      .setDesc(
        "绝对路径：笔记里写完整盘符，DLink 可直接显示/播放原文件；换机器需替换盘符。" +
          "根相对：只写 杭州/西湖/01.mp4，插件解析为播放器；照片建议绝对路径。"
      )
      .addDropdown((dropdown) => {
        dropdown
          .addOption("absolute", "绝对路径（推荐，DLink 直接识别）")
          .addOption("relative", "根相对（可移植，插件解析）")
          .setValue(this.plugin.settings.mediaLinkMode)
          .onChange(async (value) => {
            this.plugin.settings.mediaLinkMode = value === "relative" ? "relative" : "absolute";
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("高德服务")
      .setDesc("Key 不写入 data.json，也不会在设置页回显。优先读环境变量，其次读库外 JSON 文件。")
      .setHeading();

    new Setting(containerEl)
      .setName("Key 配置文件")
      .setDesc(
        "库外 JSON 路径，例如 D:\\TravelMap\\amap-keys.json，格式：{ \"webKey\": \"…\", \"jsKey\": \"…\", \"securityCode\": \"…\" }。" +
          "环境变量 AMAP_WEB_KEY / AMAP_JS_KEY / AMAP_SECURITY_CODE 优先；Key 文件不能放在 Vault 内。"
      )
      .addText((text) => {
        text
          .setPlaceholder("D:\\TravelMap\\amap-keys.json")
          .setValue(this.plugin.settings.amapConfigPath)
          .onChange(async (value) => {
            this.plugin.settings.amapConfigPath = value.trim();
            await this.plugin.saveSettings();
          });
      });

    const keyStatusSetting = new Setting(containerEl)
      .setName("Key 状态")
      .setDesc("只显示是否已配置，不显示内容。Web 服务 Key 与 JS API Key 不通用。");
    this.keyStatusEl = keyStatusSetting.descEl.createDiv({ cls: "travel-key-status" });
    void this.renderKeyStatus();

    new Setting(containerEl)
      .setName("POI 分类码白名单")
      .setDesc(
        "高德 types 参数，用 | 分隔。默认 110000 风景名胜、140100 博物馆、140200 展览馆、140300 美术馆、190500 标志性建筑。"
      )
      .addText((text) => {
        text
          .setPlaceholder("110000|140100|140200|140300|190500")
          .setValue(this.plugin.settings.poiTypes)
          .onChange(async (value) => {
            this.plugin.settings.poiTypes = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("地图模式")
      .setDesc(
        "“允许在线地图”不会在打开视图时自动加载；只有点「在线地图」才初始化一次。" +
          "“仅离线总览”完全不加载高德 JS API。"
      )
      .addDropdown((dropdown) => {
        dropdown
          .addOption("auto", "允许在线地图（手动加载）")
          .addOption("offline", "仅离线总览")
          .setValue(this.plugin.settings.mapMode)
          .onChange(async (value) => {
            this.plugin.settings.mapMode = value === "offline" ? "offline" : "auto";
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("地图包目录")
      .setDesc(
        "填写你自己准备的边界数据目录（绝对路径），目录内需要 china-provinces.geojson、china-cities.geojson、china-counties.geojson 三个文件。" +
          "留空时读取插件目录下的 assets/geo/。本插件不附带任何边界数据。"
      )
      .addText((text) => {
        text
          .setPlaceholder("例如 D:\\TravelMap\\china-boundaries")
          .setValue(this.plugin.settings.mapPackDir)
          .onChange(async (value) => {
            this.plugin.settings.mapPackDir = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("地图配色")
      .setDesc("离线地图的省/市/区县填色、边界和地点圆点都可以单独改色；保存后已打开的地图会立即刷新。")
      .setHeading();

    this.addMapColorSetting(
      containerEl,
      "省份颜色",
      "省级填色和边界。",
      "mapProvinceColor"
    );
    this.addMapColorSetting(
      containerEl,
      "城市颜色",
      "市级边界和浅填色。",
      "mapCityColor"
    );
    this.addMapColorSetting(
      containerEl,
      "区县颜色",
      "区县填色和边界。",
      "mapCountyColor"
    );
    this.addMapColorSetting(
      containerEl,
      "地点圆点颜色",
      "所有地点 marker 的圆点颜色；不再按省市县分级。",
      "mapPlaceColor"
    );

    new Setting(containerEl)
      .setName("在线地图空闲休眠（分钟）")
      .setDesc(
        "0 = 不休眠（最省地图初始化次数；已加载的地图会保留）。设置大于 0 后，地图无操作达到该时间会自动销毁，恢复时重新计一次初始化。" +
          "只想省费用建议保持 0，切回总览不会重复加载。"
      )
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text.inputEl.max = "120";
        text
          .setValue(String(this.plugin.settings.mapIdleMinutes))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
              this.plugin.settings.mapIdleMinutes = Math.min(
                120,
                Math.max(0, Math.trunc(parsed))
              );
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName("单次会话搜索硬上限")
      .setDesc("默认 60 次。联想、取结果都计数；达到上限后提示重启视图。")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = "500";
        text
          .setValue(String(this.plugin.settings.sessionSearchLimit))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
              this.plugin.settings.sessionSearchLimit = Math.min(
                500,
                Math.max(1, Math.trunc(parsed))
              );
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName("ffprobe 路径（可选）")
      .setDesc("填写后，媒体清单会读取视频时长；留空则显示 —。需要本机已安装 ffprobe。")
      .addText((text) => {
        text
          .setPlaceholder("C:\\ffmpeg\\bin\\ffprobe.exe")
          .setValue(this.plugin.settings.ffprobePath)
          .onChange(async (value) => {
            this.plugin.settings.ffprobePath = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName("配额计数").setHeading();
    const quotaSetting = new Setting(containerEl)
      .setName("本地请求计数")
      .setDesc("仅用于排查，与控制台数字对不上时以高德控制台为准。");
    this.quotaEl = quotaSetting.descEl.createDiv({ cls: "travel-quota" });
    this.renderQuota();
    quotaSetting.addButton((button) =>
      button.setButtonText("重置会话").onClick(() => {
        this.plugin.amap.resetSessionCount();
        this.renderQuota();
      })
    );
    quotaSetting.addButton((button) =>
      button.setButtonText("重置全部计数").onClick(() => {
        this.plugin.amap.resetAllCounters();
        this.renderQuota();
      })
    );

    new Setting(containerEl).setName("维护").setHeading();
    const maintenance = containerEl.createDiv({ cls: "travel-settings__actions" });
    createButton(
      maintenance,
      "重建索引",
      () => {
        void this.plugin.reindex().then((counts) => {
          new Notice(
            `索引已重建：${counts.places} 个地点，${counts.logs} 篇日志，${counts.trips} 个行程`
          );
        });
      },
      { icon: "refresh-cw" }
    );
    createButton(maintenance, "数据自检", () => {
      new SelfCheckModal(this.plugin).open();
    }, { icon: "shield-check" });
    createButton(maintenance, "导入旧笔记", () => {
      new ImportFolderModal(this.plugin).open();
    }, { icon: "download" });
    createButton(
      maintenance,
      "更新媒体清单",
      () => {
        void this.plugin.runMediaManifest();
      },
      { icon: "list" }
    );

    const about = containerEl.createDiv({ cls: "travel-settings__about" });
    about.createDiv({
      text:
        "数据模型：地点 kind: place；日志 kind: travel-log；行程 kind: trip。" +
        "所有关联靠 id，文件名只给人看。坐标只存 GCJ-02。",
    });
    about.createDiv({
      text:
        "行政区划名称来自 china-division（MIT）；边界数据由用户自备地图包提供，插件不附带、不再分发。" +
        "公开使用前请自行核对地图数据许可与审图要求。",
    });
  }

  private async renderKeyStatus(): Promise<void> {
    const target = this.keyStatusEl;
    if (!target) return;
    target.empty();
    target.createDiv({ cls: "travel-empty__hint", text: "检查中…" });
    try {
      const status = await this.plugin.amap.keyStatus();
      target.empty();
      const line = (label: string, ok: boolean) => {
        const row = target.createDiv({ cls: "travel-key-status__row" });
        row.createSpan({
          cls: `travel-status-dot ${ok ? "is-ok" : "is-missing"}`,
        });
        row.createSpan({ text: `${label}：${ok ? "已配置" : "未配置"}` });
      };
      line("Web 服务 Key", status.web);
      line("JS API Key", status.js);
      line("JS 安全密钥", status.security);
      if (status.configError) {
        target.createDiv({ cls: "travel-warning", text: status.configError });
      }
      target.createDiv({
        cls: "travel-empty__hint",
        text:
          `来源：${
            { env: "环境变量", file: "库外文件", mixed: "环境变量 + 库外文件", none: "未找到" }[
              status.source
            ]
          } · 配置文件：${status.configPath || "未填写"}`,
      });
      const actions = target.createDiv({ cls: "travel-key-status__actions" });
      createButton(actions, "重新读取 Key", () => {
        void this.plugin.amap.refreshKeys().then(() => {
          void this.renderKeyStatus();
          new Notice("已重新读取高德 Key");
        });
      });
    } catch (error) {
      target.empty();
      target.createDiv({
        cls: "travel-warning",
        text: `读取 Key 状态失败：${(error as Error).message}`,
      });
    }
  }

  private renderQuota(): void {
    const target = this.quotaEl;
    if (!target) return;
    const snapshot = this.plugin.amap.quotaSnapshot();
    target.empty();
    target.createDiv({
      text: `本会话 ${snapshot.sessionCount} / ${snapshot.sessionLimit} 次；今日 ${snapshot.dayCount} 次；本月 ${snapshot.monthCount} 次。`,
    });
  }
}
