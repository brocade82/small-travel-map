/**
 * Creates a disposable Obsidian vault for manual/automated testing.
 *
 *   node scripts/create-dev-vault.mjs
 *
 * The vault contains only fake travel data. It is safe to delete and recreate.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const vault = path.join(root, "dev-vault");
const media = path.join(root, "dev-media");

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function write(relative, content) {
  const target = path.join(vault, relative);
  ensure(path.dirname(target));
  fs.writeFileSync(target, content, "utf8");
}

function writeMedia(relative, content) {
  const target = path.join(media, relative);
  ensure(path.dirname(target));
  fs.writeFileSync(target, content);
}

function list(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function placeYaml(place) {
  const lines = [
    "---",
    "kind: place",
    "schema_version: 1",
    `id: ${JSON.stringify(place.id)}`,
    `name: ${JSON.stringify(place.name)}`,
    `aliases: ${list(place.aliases ?? [])}`,
    `amap_poi_id: ${JSON.stringify(place.amapPoiId)}`,
    `province: ${JSON.stringify(place.province)}`,
  ];
  if (place.city) lines.push(`city: ${JSON.stringify(place.city)}`);
  if (place.district) lines.push(`district: ${JSON.stringify(place.district)}`);
  lines.push(
    `adcode: ${JSON.stringify(place.adcode)}`,
    `lat: ${place.lat}`,
    `lng: ${place.lng}`,
    "coordinate_system: GCJ-02",
    "coord_source: amap",
    `visited: ${place.visited === false ? "false" : "true"}`,
    `tags: ${list(["旅游/景点"])}`,
    "created: 2026-10-26T21:40:00+08:00",
    "updated: 2026-10-26T21:40:00+08:00",
    "---",
    ""
  );
  return lines.join("\n");
}

const places = [
  { id: "20261026-ai7k3m", name: "西湖", folder: "杭州", adcode: "330106", lat: 30.2489, lng: 120.1486, province: "浙江省", city: "杭州市", district: "西湖区", amapPoiId: "B0FFHZHEJI" },
  { id: "20251001-bj0001", name: "故宫博物院", folder: "北京", adcode: "110101", lat: 39.9163, lng: 116.3972, province: "北京市", city: "北京市", district: "东城区", amapPoiId: "B000A8UIN8" },
  { id: "20250315-sh0001", name: "外滩", folder: "上海", adcode: "310101", lat: 31.2397, lng: 121.49, province: "上海市", city: "上海市", district: "黄浦区", amapPoiId: "B000A7YQ3F" },
  { id: "20240920-xa0001", name: "兵马俑", folder: "西安", adcode: "610115", lat: 34.3841, lng: 109.2785, province: "陕西省", city: "西安市", district: "临潼区", amapPoiId: "B0FFHDC5LM" },
  { id: "20240610-xm0001", name: "鼓浪屿", folder: "厦门", adcode: "350203", lat: 24.4472, lng: 118.0678, province: "福建省", city: "厦门市", district: "思明区", amapPoiId: "B0FFH8V0X1" },
  { id: "20231105-hs0001", name: "黄山风景区", folder: "黄山", adcode: "341003", lat: 30.1333, lng: 118.1667, province: "安徽省", city: "黄山市", district: "黄山区", amapPoiId: "B0FFHB7K9R", visited: false },
  { id: "20231002-wz0001", name: "乌镇", folder: "嘉兴", adcode: "330483", lat: 30.745, lng: 120.487, province: "浙江省", city: "嘉兴市", district: "桐乡市", amapPoiId: "B0FFH9L2R8" },
  { id: "20230915-cd0001", name: "宽窄巷子", folder: "成都", adcode: "510105", lat: 30.6699, lng: 104.0552, province: "四川省", city: "成都市", district: "青羊区", amapPoiId: "B0FFH6YQ2N" },
  { id: "20230701-gl0001", name: "漓江", folder: "桂林", adcode: "450321", lat: 24.7785, lng: 110.4966, province: "广西壮族自治区", city: "桂林市", district: "阳朔县", amapPoiId: "B0FFH3M1P7" },
  { id: "20230601-sy0001", name: "天涯海角", folder: "三亚", adcode: "460202", lat: 18.296, lng: 109.348, province: "海南省", city: "三亚市", district: "海棠区", amapPoiId: "B0FFH2K8Q4" },
  { id: "20230501-mo0001", name: "大三巴牌坊", folder: "澳门", adcode: "820000", lat: 22.1975, lng: 113.5408, province: "澳门特别行政区", amapPoiId: "B0FFH1M6T2" },
  { id: "20230401-tp0001", name: "台北101", folder: "台湾", adcode: "710000", lat: 25.0339, lng: 121.5645, province: "台湾省", amapPoiId: "B0FFH0P3S9" },
  { id: "20230301-jy0001", name: "王屋山", folder: "河南", adcode: "419001", lat: 35.1, lng: 112.5, province: "河南省", city: "济源市", amapPoiId: "B0FFGZQ7W5" },
  { id: "20230201-bj0002", name: "北京环球影城", folder: "北京", adcode: "110112", lat: 39.856, lng: 116.674, province: "北京市", city: "北京市", district: "通州区", amapPoiId: "B0FFGYT2J8", visited: false },
];

for (const place of places) {
  const heading = `# ${place.name}\n\n> ${[place.province, place.city, place.district].filter(Boolean).join(" / ")} · ${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}（GCJ-02）\n\n在命令面板运行「新建旅行日志」，或打开旅行时间线。\n`;
  write(`旅游/地点/${place.folder}/${place.name}.md`, placeYaml(place) + heading);
}

const trips = [
  { id: "20261026-c7p4wd", title: "2026 杭州", file: "2026-杭州", start: "2026-10-26", end: "2026-10-28", cities: ["杭州市"] },
  { id: "20251001-b7p4wd", title: "2025 北京", file: "2025-北京", start: "2025-10-01", end: "2025-10-03", cities: ["北京市"] },
];

for (const trip of trips) {
  const yaml = [
    "---",
    "kind: trip",
    "schema_version: 1",
    `id: ${JSON.stringify(trip.id)}`,
    `title: ${JSON.stringify(trip.title)}`,
    `start: ${trip.start}`,
    `end: ${trip.end}`,
    `cities: ${list(trip.cities)}`,
    `tags: ${list(["旅游/行程"])}`,
    "created: 2026-10-26T21:40:00+08:00",
    "updated: 2026-10-26T21:40:00+08:00",
    "---",
    "",
    `# ${trip.title}`,
    "",
  ].join("\n");
  write(`旅游/行程/${trip.file}.md`, yaml);
}

const logs = [
  {
    id: "20261026-l00001",
    placeId: "20261026-ai7k3m",
    placePath: "旅游/地点/杭州/西湖",
    date: "2026-10-26",
    title: "断桥的傍晚",
    tags: ["旅游/日志", "景点", "日落"],
    pinned: true,
    trip: "旅游/行程/2026-杭州",
    cover: "旅游/媒体/照片/杭州/西湖/cover.svg",
    body: "## 断桥的傍晚\n\n傍晚从断桥走到白堤，风把湖面吹出细小的纹路。\n\n照片：\n\n![[2026-10-26-01.svg]]\n\n视频：\n\n[▶ 2026-10-26 西湖](local-file:///D:/TravelMedia/杭州/西湖/2026-10-26-01.mp4)\n",
  },
  {
    id: "20261027-l00002",
    placeId: "20261026-ai7k3m",
    placePath: "旅游/地点/杭州/西湖",
    date: "2026-10-27",
    title: "苏堤晨跑",
    tags: ["旅游/日志", "跑步"],
    pinned: false,
    trip: "旅游/行程/2026-杭州",
    body: "## 苏堤晨跑\n\n六点出门，苏堤上只有扫落叶的人。跑完在花港观鱼吃早饭。\n",
  },
  {
    id: "20250405-l00003",
    placeId: "20261026-ai7k3m",
    placePath: "旅游/地点/杭州/西湖",
    date: "2025-04-05",
    title: "清明西湖",
    tags: ["旅游/日志", "清明"],
    pinned: false,
    body: "## 清明西湖\n\n人很多，但湖边柳树正好。下次避开假期。\n",
  },
  {
    id: "20251001-l00004",
    placeId: "20251001-bj0001",
    placePath: "旅游/地点/北京/故宫博物院",
    date: "2025-10-01",
    title: "故宫一日",
    tags: ["旅游/日志", "博物馆"],
    pinned: false,
    trip: "旅游/行程/2025-北京",
    body: "## 故宫一日\n\n从午门进，先看武英殿，再走中轴线。闭馆前在角楼等光线。\n",
  },
  {
    id: "20251002-l00005",
    placeId: "20251001-bj0001",
    placePath: "旅游/地点/北京/故宫博物院",
    date: "2025-10-02",
    title: "景山看日落",
    tags: ["旅游/日志", "日落"],
    pinned: false,
    trip: "旅游/行程/2025-北京",
    body: "## 景山看日落\n\n从神武门出来，过街就是景山。万春亭上能看到整条中轴线。\n",
  },
  {
    id: "20250315-l00006",
    placeId: "20250315-sh0001",
    placePath: "旅游/地点/上海/外滩",
    date: "2025-03-15",
    title: "外滩的夜",
    tags: ["旅游/日志", "夜景"],
    pinned: false,
    body: "## 外滩的夜\n\n江风很冷，灯火把对岸的楼切成一块一块。\n",
  },
  {
    id: "20240920-l00007",
    placeId: "20240920-xa0001",
    placePath: "旅游/地点/西安/兵马俑",
    date: "2024-09-20",
    title: "一号坑",
    tags: ["旅游/日志", "博物馆"],
    pinned: false,
    body: "## 一号坑\n\n站在坑边看了很久。每个陶俑的脸都不一样。\n",
  },
  {
    id: "20240610-l00008",
    placeId: "20240610-xm0001",
    placePath: "旅游/地点/厦门/鼓浪屿",
    date: "2024-06-10",
    title: "鼓浪屿的雨",
    tags: ["旅游/日志", "海岛"],
    pinned: false,
    body: "## 鼓浪屿的雨\n\n上岛就下雨，躲进一栋老别墅改的咖啡馆。\n",
  },
  {
    id: "20231002-l00009",
    placeId: "20231002-wz0001",
    placePath: "旅游/地点/嘉兴/乌镇",
    date: "2023-10-02",
    title: "乌镇夜船",
    tags: ["旅游/日志", "古镇"],
    pinned: false,
    body: "## 乌镇夜船\n\n坐最后一班摇橹船回客栈，两岸的灯映在水里。\n",
  },
  {
    id: "20230915-l00010",
    placeId: "20230915-cd0001",
    placePath: "旅游/地点/成都/宽窄巷子",
    date: "2023-09-15",
    title: "宽窄巷子的下午",
    tags: ["旅游/日志", "茶馆"],
    pinned: false,
    body: "## 宽窄巷子的下午\n\n在巷子里喝盖碗茶，听隔壁桌摆龙门阵。\n",
  },
  {
    id: "20230701-l00011",
    placeId: "20230701-gl0001",
    placePath: "旅游/地点/桂林/漓江",
    date: "2023-07-01",
    title: "漓江竹筏",
    tags: ["旅游/日志", "山水"],
    pinned: false,
    body: "## 漓江竹筏\n\n从杨堤到兴坪，水面上全是山的倒影。\n",
  },
  {
    id: "20230601-l00012",
    placeId: "20230601-sy0001",
    placePath: "旅游/地点/三亚/天涯海角",
    date: "2023-06-01",
    title: "天涯海角",
    tags: ["旅游/日志", "海边"],
    pinned: false,
    body: "## 天涯海角\n\n石头比想象中大，海水比想象中蓝。\n",
  },
  {
    id: "20230501-l00013",
    placeId: "20230501-mo0001",
    placePath: "旅游/地点/澳门/大三巴牌坊",
    date: "2023-05-01",
    title: "大三巴",
    tags: ["旅游/日志", "港澳台"],
    pinned: false,
    body: "## 大三巴\n\n牌坊下面全是人。拐进旁边的小巷才安静下来。\n",
  },
];

for (const log of logs) {
  const yaml = [
    "---",
    "kind: travel-log",
    "schema_version: 1",
    `id: ${JSON.stringify(log.id)}`,
    `place_id: ${JSON.stringify(log.placeId)}`,
    `place: ${JSON.stringify(`[[${log.placePath}]]`)}`,
    log.trip ? `trip: ${JSON.stringify(`[[${log.trip}]]`)}` : null,
    `visited_start: ${log.date}`,
    `visited_end: ${log.date}`,
    `date: ${log.date}`,
    `tags: ${list(log.tags)}`,
    `pinned: ${log.pinned ? "true" : "false"}`,
    log.cover ? `cover: ${JSON.stringify(log.cover)}` : null,
    "created: 2026-10-26T22:10:00+08:00",
    "updated: 2026-10-26T22:10:00+08:00",
    "---",
    "",
    log.body,
  ]
    .filter((line) => line !== null)
    .join("\n");
  write(`旅游/日志/${log.date}-${log.title}.md`, yaml);
}

// A plain note inside the travel folder: indexed read-only as kind: legacy.
write(
  "旅游/旧笔记/没有 frontmatter.md",
  "# 早年的旅行清单\n\n- 西湖\n- 故宫\n- 鼓浪屿\n\n没有日期，也没有地点关联。插件只读兼容，不修改文件。\n"
);

// Notes outside the travel folder, used by the importer (dry-run).
write(
  "旧游记/2024-05-01-厦门.md",
  "# 厦门三日\n\n从曾厝垵走到环岛路，海风很大。\n\n[[城市/厦门]]\n"
);
write(
  "旧游记/随手记.md",
  "# 一次没有日期的短途\n\n只记得吃了很多海鲜。\n"
);

// Photos (vault attachments) and a fake external video.
const coverSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6c177"/>
      <stop offset="0.55" stop-color="#e8956d"/>
      <stop offset="1" stop-color="#6d7f9b"/>
    </linearGradient>
  </defs>
  <rect width="800" height="450" fill="url(#sky)"/>
  <circle cx="610" cy="120" r="46" fill="#fff3d6" opacity="0.9"/>
  <path d="M0 330 L150 250 L300 320 L470 240 L640 310 L800 260 L800 450 L0 450 Z" fill="#2f4058" opacity="0.85"/>
  <path d="M0 372 L180 320 L360 370 L560 315 L800 365 L800 450 L0 450 Z" fill="#1d2a3a"/>
  <text x="36" y="70" fill="#fff8ea" font-family="sans-serif" font-size="30">西湖 · 断桥日落</text>
</svg>`;
write("旅游/媒体/照片/杭州/西湖/cover.svg", coverSvg);
write("旅游/媒体/照片/杭州/西湖/2026-10-26-01.svg", coverSvg);

const fakeVideo = Buffer.alloc(64 * 1024, 0);
fakeVideo.write("FAKE-MP4-FOR-TRAVEL-MAP-TESTS", 0, "utf8");
writeMedia("杭州/西湖/2026-10-26-01.mp4", fakeVideo);

const amapKeys = {
  _comment: "This test vault runs offline. Put real keys here only for a manual online test.",
};
writeMedia("amap-keys.json", `${JSON.stringify(amapKeys, null, 2)}\n`);

// Obsidian configuration.
write(".obsidian/app.json", `${JSON.stringify({ trashOption: "local" }, null, 2)}\n`);
write(".obsidian/community-plugins.json", `${JSON.stringify(["travel-map"], null, 2)}\n`);
write(
  "欢迎.md",
  "# 旅游地图调试库\n\n这个库只放测试数据。打开命令面板，运行「旅游地图：打开旅游地图」或「打开旅行时间线」。\n"
);

console.log(`dev vault ready: ${vault}`);
console.log(`fake media ready: ${media}`);
console.log(`places=${places.length} logs=${logs.length} trips=${trips.length}`);
