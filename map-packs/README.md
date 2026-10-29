# 地图包（用户自备）

本发布版**不包含任何行政边界数据**。离线地图需要你自己准备地图包，并确认数据许可。

## 目录格式

地图包是一个普通文件夹，里面至少包含：

```text
your-map-pack/
├─ china-provinces.geojson
├─ china-cities.geojson
└─ china-counties.geojson
```

可选：

```text
meta.json
```

每个 `.geojson` 都是标准 `FeatureCollection`。插件会读取每个 feature 的：

```json
{
  "type": "Feature",
  "properties": {
    "adcode": "330106",
    "name": "西湖区",
    "level": "district",
    "center": [120.13, 30.26]
  },
  "geometry": { "type": "Polygon", "coordinates": [] }
}
```

- `adcode`：必填，和地点档案里的 adcode 对应
- `name`：必填，地图标签使用
- `center`：可选，`[经度, 纬度]`
- `level`：可选，`province` / `city` / `district`
- `geometry`：`Polygon` 或 `MultiPolygon`

## 放在哪里

### 方式一：插件目录

```text
<你的 Vault>/.obsidian/plugins/travel-map/assets/geo/
├─ china-provinces.geojson
├─ china-cities.geojson
└─ china-counties.geojson
```

设置里的「地图包目录」留空即可。

### 方式二：任意绝对目录

例如：

```text
D:\TravelMap\china-boundaries\
```

在 Obsidian →「设置」→「旅游地图」→「地图包目录」填写：

```text
D:\TravelMap\china-boundaries
```

## 数据要求

- **必须使用 GCJ-02 坐标**。插件保存的地点坐标来自高德，也是 GCJ-02；直接使用 WGS-84 的边界会偏移。
- 省/市/区县的 `adcode` 要与地点档案一致。
- 台湾、港澳、直辖市、省直辖县等的覆盖情况取决于你的地图包。
- 地图包不要求与插件一起发布；你可以只在自己机器上使用。

## 许可

地图包由你自己提供，插件不附带、不转售、不再分发。

请自行确认：

- 数据源是否允许你使用和再分发
- 是否需要署名
- 中国地图审图/边界合规要求
- 坐标转换是否符合要求

常见数据源示例（不构成授权建议）：

- OpenStreetMap（ODbL，需署名/ share-alike）
- geoBoundaries（CC BY 4.0，覆盖层级需自行确认）
- 其他你有权使用的行政区划数据

## 没有地图包时

插件仍可使用地点、日志、行程时间线、媒体和导入功能；打开离线地图会显示错误提示，提示你填写地图包目录。
