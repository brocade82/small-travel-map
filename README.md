# 旅游地图（Travel Map）

一个面向 Obsidian 桌面端的本地优先旅行记录插件：

- 搜索并保存旅行地点
- 为地点写多篇旅行日志
- 用「行程 → 日志」树回顾整次旅行
- 用 Leaflet 查看本地行政区边界并点亮省/市/区县
- 可选加载高德在线地图
- 照片和视频继续放在库外，用原文件显示/播放

> 插件版本：`0.1.1`  
> 最低 Obsidian：`1.5.0`  
> 平台：Windows / macOS / Linux 桌面端（`isDesktopOnly: true`）  
> 插件 ID：`travel-map`

> **重要：本发布版不包含任何地图边界数据。**  
> 离线地图需要你自己准备地图包（见下文「地图包」），并确认数据许可与坐标要求。

---

## 功能

| 功能 | 说明 |
|---|---|
| 地点档案 | 每个地点一个 Markdown 文件，保存 adcode、GCJ-02 坐标、行政区和标签 |
| 旅行日志 | 同一地点可以写任意多篇日志，通过 `place_id` 关联 |
| 行程树时间线 | 行程是父节点，日志是可展开的子节点；行程显示摘要、日期范围、城市和标签 |
| 离线地图 | Leaflet + 用户自备的省/市/区县 GeoJSON；不加载在线瓦片 |
| 点亮统计 | 省、市、区县分层点亮；颜色可配置 |
| 地图日志 | 点击区县或地点，打开可拖动、可调整大小的日志浮窗 |
| 在线地图 | 高德 JS API 2.0，可选；仅在点击「在线地图」时加载 |
| 库外媒体 | 照片/视频放在库外，通过 DLink 的 `file:///` 链接读取原文件 |
| 导入旧笔记 | 普通 `.md` / `.txt` 即可，不要求插件专用格式 |
| 数据自检 | 检查缺失 ID、未知 adcode、失效关联和媒体缺失 |

---

## 安装

### 方式一：手动安装

1. 从 GitHub Releases 下载：
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. 在你的 Vault 中创建目录：

```text
<你的 Vault>/.obsidian/plugins/travel-map/
```

3. 把三个文件放进去：

```text
<你的 Vault>/.obsidian/plugins/travel-map/
├─ main.js
├─ manifest.json
└─ styles.css
```

4. 打开 Obsidian →「设置」→「第三方插件」→ 关闭安全模式 → 刷新插件列表 → 启用 **旅游地图**。

### 方式二：BRAT

使用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 添加本插件的 GitHub 仓库，再启用插件。

### 方式三：Obsidian 社区目录

上架后可直接在「第三方插件」中搜索安装。本发布版仍需要你另外准备地图包。

---

## 地图包（必须自备）

离线地图不附带任何边界数据。插件只读取你提供的地图包。

地图包是一个文件夹，至少包含：

```text
your-map-pack/
├─ china-provinces.geojson
├─ china-cities.geojson
└─ china-counties.geojson
```

每个文件都是标准 `FeatureCollection`。插件使用每个 feature 的：

```json
{
  "type": "Feature",
  "properties": {
    "adcode": "330106",
    "name": "西湖区",
    "level": "district",
    "center": [120.13, 30.26]
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": []
  }
}
```

要求：

- `adcode` 必填，必须和地点档案里的 adcode 一致
- `name` 必填
- `center` 可选，`[经度, 纬度]`
- `geometry` 支持 `Polygon` / `MultiPolygon`
- **坐标必须是 GCJ-02**，与高德地点坐标一致；直接使用 WGS-84 会偏移

详细格式见 [`map-packs/README.md`](map-packs/README.md)。

### 地图包放哪里

#### 方式一：插件目录

```text
<你的 Vault>/.obsidian/plugins/travel-map/assets/geo/
├─ china-provinces.geojson
├─ china-cities.geojson
└─ china-counties.geojson
```

设置里的「地图包目录」留空即可。

#### 方式二：任意目录

例如：

```text
D:\TravelMap\china-boundaries\
```

在 Obsidian →「设置」→「旅游地图」→「地图包目录」填写：

```text
D:\TravelMap\china-boundaries
```

### 地图包许可

地图包由你自己提供，插件不附带、不转售、不再分发。

你需要自行确认：

- 数据源是否允许使用和再分发
- 是否需要署名
- 中国地图审图/边界合规要求
- GCJ-02 坐标转换是否符合要求

常见数据源示例（不构成授权建议）：

- OpenStreetMap（ODbL，需署名，衍生数据库有 share-alike 要求）
- geoBoundaries（CC BY 4.0，覆盖层级需自行确认）
- 其他你有权使用的行政区划数据

没有地图包时，地点、日志、行程时间线、媒体和导入仍然可用；打开离线地图会显示提示，要求设置地图包目录。

---

## 首次配置

打开 Obsidian →「设置」→「旅游地图」。

### 1. 旅游目录

默认：

```text
旅游
```

相对 Vault 根目录，插件会创建：

```text
<你的 Vault>/
├─ .obsidian/
│  └─ plugins/
│     └─ travel-map/
└─ 旅游/
   ├─ 地点/
   ├─ 日志/
   ├─ 行程/
   └─ 媒体清单.md
```

### 2. 媒体根目录（可选）

照片和视频不必放进 Vault。示例：

```text
D:\TravelMedia
```

目录可以按自己的习惯组织：

```text
D:\TravelMedia\
├─ 杭州\
│  └─ 西湖\
│     ├─ 2026-05-01-01.jpg
│     └─ 2026-05-01-02.mp4
└─ 西安\
   └─ 兵马俑\
      └─ 2026-08-18-01.mp4
```

插件只读取这些文件，不复制、不转码、不生成缩略图。

### 3. DLink（可选，但推荐）

库外照片/视频的显示依赖 [DLink](https://github.com/MarcBolo/DLink) 之类的插件，把 `file:///` 链接转成可播放的 blob。

- 安装并启用 DLink 后，日志中的库外照片和视频可以内联显示/播放。
- 没有 DLink 时，插件显示降级文本，不产生死链。
- 视频外层会加尺寸限制和圆角边框，但播放的仍是原始 MP4 文件。

---

## 高德地图服务（可选，第三方）

本插件**不附带高德 Key**，也不代理高德服务。搜索和在线地图都需要你自己申请高德开放平台账号与 Key。

| 能力 | 使用的 Key | 是否收费/受配额影响 |
|---|---|---|
| 地点搜索、联想 | 高德 **Web 服务** Key | 是，受高德配额和服务条款约束 |
| 在线地图 | 高德 **JS API** Key + 安全密钥 | 是，地图初始化会消耗配额 |
| 离线地图 | 不需要 Key | 不使用高德服务 |

使用前提：

- 有自己的高德开放平台账号
- 已开通 Web 服务 API / JS API 2.0
- Key 的域名/来源白名单配置正确
- 同意高德开放平台的服务条款和隐私规则

插件行为：

- 不配置 Key 也能使用地点、日志、行程树、离线地图、媒体和导入
- 只有点击「在线地图」才初始化高德 JS 地图
- 默认不自动加载在线地图
- 不缓存地图瓦片，不批量转存 POI
- 搜索请求会发送到高德服务器，受高德配额限制
- 在线地图的计费/配额以高德控制台为准

### Key 配置

Key 文件必须放在 Vault 外面，例如：

```text
D:\TravelMap\amap-keys.json
```

内容格式：

```json
{
  "webKey": "你的 Web 服务 Key",
  "jsKey": "你的 JS API Key",
  "securityCode": "你的安全密钥"
}
```

也可以使用环境变量，优先级高于文件：

```text
AMAP_WEB_KEY
AMAP_JS_KEY
AMAP_SECURITY_CODE
```

> 不要把 Key 写进 Vault 内的 Markdown、`data.json` 或 Git 仓库。  
> 如果高德控制台提示域名/来源不合法，需要在控制台补充 `app://obsidian.md` 或对应来源配置。

---

## 使用流程

### 保存地点

1. 打开「旅游地图」。
2. 在左侧搜索框输入地点，例如「西湖」「故宫」。
3. 选择高德结果并保存。
4. 插件会生成：

```text
旅游/地点/<城市>/<地点名>.md
```

保存后地点会立即点亮；也可以在详情中取消点亮。

### 写旅行日志

1. 在地点详情中点击「新建旅行日志」，或使用命令面板。
2. 填写日期、标题、正文，插入照片/视频。
3. 日志会生成：

```text
旅游/日志/YYYY-MM-DD-标题.md
```

同一地点可以有多篇日志，例如：

```text
2026-05-02-西湖.md
2026-10-26-断桥的傍晚.md
2026-10-27-苏堤晨跑.md
```

### 行程与时间线

时间线默认是「行程树」：

```text
2026 年 08 月
└─ 2026 西安旅行              ← 行程父节点
   ├─ 2026-08-18 西安那些事   ← 日志子节点
   ├─ 2026-07-24 西安花费
   └─ 2026-08-20 兵马俑
```

- 行程节点显示标题、日期范围、城市/标签、摘要、日志数量。
- 点箭头展开/收起日志。
- 行程摘要写在行程笔记正文中；新建行程时也可以填写。
- 没有关联行程的日志进入「未归入行程」节点，不会丢失。
- 右上角可切换「看板」，看板保留按日志的卡片流和照片。

关联行程：

```yaml
trip: "[[旅游/行程/2026 西安旅行]]"
```

在新建日志弹窗中选择行程，插件会自动写入。

### 地图

| 操作 | 行为 |
|---|---|
| 默认打开 | 读取地图包的离线地图 |
| 点击区县 | 打开该区县的日志浮窗 |
| 点击地点圆点 | 打开该地点的日志浮窗 |
| 点击「地图日志」 | 打开全部日志 |
| 点击「在线地图」 | 手动初始化一次高德 JS 地图 |
| 收起侧栏 | 地图占满宽度 |

离线地图没有街道、POI、乡镇/街道边界；道路和实时底图请使用在线地图。

### 日志浮窗

- 拖动标题栏移动位置
- 右下角调整大小
- 地点 chip 只筛选列表，不会自动新建
- 「新建日志」「新建行程」是独立按钮
- 点日志条目打开对应 Markdown

---

## 导入旧笔记

支持普通 `.md` 和 `.txt`，不要求插件专用 frontmatter。

可选：

```yaml
---
date: 2026-05-02
city: 杭州
tags: [旅行]
---
```

字段读取顺序：

| 字段 | 顺序 |
|---|---|
| 标题 | 正文第一个 `# 标题` → frontmatter `name` → 文件名 |
| 日期 | 文件名日期 → `visited_start` / `date` → 路径日期 → 文件 ctime |
| 城市 | frontmatter `city` → 正文 `[[城市/杭州]]` / `[[杭州市]]` |
| 地点 | `place_id` 或 `place` wiki 链接；找不到则标记「未关联地点」 |

文件名支持：

```text
2026-05-02-西湖.md
2026_05_02-西湖.md
20260502-西湖.md
```

注意：

- 只导入 `.md` / `.txt`，不复制照片和视频。
- 已有 `kind: place/travel-log/trip` 的插件笔记会跳过。
- 缺地点时不会强行猜测，导入报告会提示。
- Word/PDF 需要先转换成 Markdown。

---

## 数据与隐私

- 插件不收集遥测，不上传笔记、照片或视频。
- 旅行数据保存在 Vault 内的 Markdown 中。
- 媒体默认留在库外，插件只读取原文件。
- Key 不在 Vault 内，也不会被写回 `data.json`。
- 地图包由用户提供，插件不附带、不转售、不再分发。
- 联网只发生在：
  - 你主动使用高德搜索/联想
  - 你主动点击「在线地图」
- 离线地图不加载任何网络瓦片。

---

## 已知限制

1. 本发布版**不包含任何地图边界数据**，离线地图必须自备地图包。
2. 离线地图只到区县行政边界，不含街道、道路、POI、乡镇/街道边界。
3. 地图包必须使用 GCJ-02 坐标，并与地点 adcode 对齐。
4. 台湾、港澳、直辖市、省直辖县的覆盖取决于你的地图包。
5. 高德搜索/在线地图受高德配额、服务条款和隐私规则限制；不配置 Key 时不可用。
6. DLink 是外部插件；没有它时库外媒体只能显示降级文本。
7. 行程树目前没有独立的「行程列表页」；行程通过时间线和行程笔记管理。

---

## 开发

要求：

- Node.js 22+
- npm
- Obsidian 1.5.0+ 桌面端

```bash
npm install
npm run build
npm test
```

构建产物：

```text
main.js
manifest.json
styles.css
```

开发调试库（可选）：

```bash
node scripts/create-dev-vault.mjs
node scripts/deploy-dev.mjs
```

本项目不附带地图数据；开发时请把地图包放到插件目录的 `assets/geo/`，或使用设置中的地图包目录。

---

## 发布

发布到 GitHub / Obsidian 社区目录的步骤见：

- [docs/PUBLISHING.md](docs/PUBLISHING.md)

发布前请确认：

- `manifest.json` 的 `version` 是 `x.y.z`
- Git tag 与 `version` 完全一致
- Release 上传 `main.js`、`manifest.json`、`styles.css`
- 仓库根目录有 README 和 LICENSE
- **不要把地图包数据提交到公开仓库**
- 发布内容和历史提交中都不含 Key、个人路径或测试 Vault

---

## 许可

- 插件代码：MIT，见 [LICENSE](LICENSE)
- 第三方依赖：见 [NOTICE.md](NOTICE.md)

Leaflet 1.9.4（BSD-2-Clause）是开源渲染库。地图包数据由用户自行提供，插件不附带、不再分发。
