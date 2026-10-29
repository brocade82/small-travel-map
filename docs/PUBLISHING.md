# 发布与上传说明

本文只说明如何把插件发布到 GitHub 和 Obsidian 社区目录。仓库维护者应在审核内容后自行执行，不要把 Key、测试 Vault 或个人路径一起上传。

官方参考：

- <https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin>
- <https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins>
- <https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines>

## 0. 发布前检查

在项目根目录执行：

```bash
npm install
npm run build
npm test
```

确认：

- `main.js`、`manifest.json`、`styles.css` 存在
- `manifest.json` 的 `version` 是 `x.y.z`
- `manifest.json` 的 `author` 可以改成你自己的 GitHub 显示名
- 仓库根目录有 `README.md`、`LICENSE`
- 不要把下面这些提交到公开仓库：
  - `amap-keys.json` / 任何真实 Key
  - `.env`
  - `dev-vault/`
  - `dev-media/`
  - `node_modules/`
  - 含个人路径的截图或测试数据

建议检查：

```bash
git grep -n -i "api[_-]key\|secret\|token\|password"
git grep -n "C:\\\\Users\|D:\\\\Users\|/Users/"
```

## 1. 准备干净的发布仓库

当前开发仓库历史里可能包含测试 Vault、截图或个人路径。**不要直接把旧历史推到公开仓库。**

推荐使用整理好的干净目录：

```text
<YOUR_WORKSPACE>/obsidian-travel-map-release
```

这个目录应包含：

```text
.
├─ .gitignore
├─ manifest.json
├─ main.js
├─ styles.css
├─ README.md
├─ LICENSE
├─ NOTICE.md
├─ CHANGELOG.md
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ esbuild.config.mjs
├─ versions.json
├─ map-packs/
│  └─ README.md
├─ src/
├─ tests/
├─ scripts/
└─ docs/
   └─ PUBLISHING.md
```

说明：

- 本发布版**不包含地图包数据**；`map-packs/README.md` 只是格式说明。
- 不要把用户自己的地图包 GeoJSON 提交到公开仓库。
- 不要把 `dev-vault/`、`dev-media/`、旧截图、进度文档放进发布目录。
- `main.js` 只包含插件代码和 Leaflet，不包含边界数据。

在该目录初始化新的 Git 历史：

```powershell
cd <YOUR_WORKSPACE>\obsidian-travel-map-release
git init
git add .
git commit -m "release: travel-map 0.1.1"
git branch -M main
```

## 2. 上传到 GitHub

先在 GitHub 创建一个空仓库，例如：

```text
<YOUR_GITHUB_USER>/obsidian-travel-map
```

不要勾选自动生成 README、LICENSE 或 `.gitignore`。

然后：

```powershell
git remote add origin https://github.com/<YOUR_GITHUB_USER>/obsidian-travel-map.git
git push -u origin main
```

也可以用 GitHub 网页的 **Add file → Upload files** 上传，但推荐 Git，方便后续版本管理。

### 创建 Release

Obsidian 安装插件时只下载 Release 里的：

- `main.js`
- `manifest.json`
- `styles.css`

所以：

1. 确认 `manifest.json` 的 `version`，例如 `0.1.1`。
2. GitHub → **Releases → Draft a new release**。
3. Tag 填 **完全一致** 的版本号：

```text
0.1.1
```

不要写成 `v0.1.1`。

4. 上传三个文件：
   - `main.js`
   - `manifest.json`
   - `styles.css`
5. 发布 Release。

`map-packs/README.md` 不需要上传到 Release；它只是给用户看的格式说明。发布版不附带地图包数据。

## 3. 提交到 Obsidian 社区目录

当前官方流程：

1. 打开 <https://community.obsidian.md>。
2. 用 Obsidian 账号登录。
3. 在个人资料里关联 GitHub 账号，让目录确认你拥有这个仓库。
4. 选择添加插件（Add a plugin），填写仓库地址。
5. 目录会读取默认分支 HEAD 的 `manifest.json`；确保它已经提交。
6. 等待自动审核；按反馈修正后，发布增量版本。

提交前确认：

- `manifest.json` 的 `id` 全目录唯一，且不能包含 `obsidian`
- `version` 与 Release tag 完全一致
- Release 里只有要求的三个文件
- 根目录 README 和 LICENSE 存在
- 没有个人 Key、测试数据和本机路径

审核通过后，用户就可以在 Obsidian 的「第三方插件」里搜索并安装。

## 4. 测试版：BRAT

如果还不想提交社区目录，可以用 BRAT：

1. 安装并启用 BRAT。
2. 在 BRAT 中添加：

```text
<YOUR_GITHUB_USER>/obsidian-travel-map
```

3. 在插件列表中启用 **旅游地图**。

BRAT 会从 GitHub 仓库和 Release 拉取文件，适合小范围测试。

## 5. 手动安装

最终用户也可以直接下载 Release 的三个文件：

```text
<他们的 Vault>/.obsidian/plugins/travel-map/
├─ main.js
├─ manifest.json
└─ styles.css
```

然后启用插件。离线地图需要用户自己准备地图包：

- 放到 `<Vault>/.obsidian/plugins/travel-map/assets/geo/`
- 或在设置「地图包目录」指定任意目录
- 插件不附带、不再分发任何边界数据

## 6. 版本升级

每次发布：

1. 修改 `manifest.json` 的 `version`
2. 更新 `versions.json`
3. 重新构建 `main.js`
4. 提交
5. 创建同版本 tag 和 GitHub Release
6. 上传新的三个文件

Obsidian 会按 `manifest.json` 中的版本匹配 Release。

## 7. 注意事项

- **不要上传开发历史**：旧提交可能包含测试媒体、个人路径或 Key 路径。使用干净的发布目录。
- **不要上传测试 Vault**：里面通常有示例笔记和个人目录结构。
- **不要上传真实 Key**：Key 应只存在于库外文件或环境变量。
- **不要上传地图包**：本发布版不附带任何边界数据；公开仓库不要提交 GeoJSON 地图包，用户自行准备并确认许可。
- **高德条款**：搜索/在线地图使用高德服务，需用户自备 Key，受高德配额、服务条款和隐私规则限制。
- **高德条款**：在线搜索/地图受高德开放平台配额和服务条款约束，不要批量转存或缓存瓦片。
- **不要自动 push**：发布前由仓库维护者自己审核 README、截图、manifest 和 Release 文件。
