import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { dateStamp, generateId, isTravelId, randomBase36 } from "../src/core/ids";
import {
  deriveDateFromFilename,
  deriveDateFromPath,
  normalizeDate,
  toLocalIsoString,
} from "../src/core/dates";
import { gcj02ToWgs84, wgs84ToGcj02 } from "../src/core/geo";
import {
  adcodeFromNames,
  cityNameOf,
  isKnownAdcode,
  normalizeAdcode,
  provinceNameOf,
  rollup,
} from "../src/core/regions";
import {
  buildPhotoEmbed,
  buildVideoLink,
  extractVideoLinks,
  humanVideoLabel,
  isImageFile,
  joinMediaPath,
  relativeMediaPath,
  resolveMediaField,
  resolveVideoHref,
} from "../src/core/media";
import { sanitizeFileName, uniqueFileName, firstHeading } from "../src/core/text";
import { computeVisitedState } from "../src/core/visited";
import { sortTimeline, filterTimeline, type TimelineItem } from "../src/core/timeline";
import {
  addToInventory,
  classifyImportFile,
  emptyInventory,
  inventorySummary,
} from "../src/core/import";
import { isPathInside, redactSecrets, safeErrorMessage } from "../src/core/security";
import { sanitizeSettings } from "../src/core/settings";
import {
  filterSuggestions,
  queryMatchesSubSuffix,
  rankPois,
} from "../src/core/amap-rank";
import type { AmapPoi } from "../src/types";

test("ids look like YYYYMMDD-xxxxxx and are unique per random source", () => {
  const fixed = new Date(2026, 9, 26, 21, 40, 0);
  assert.equal(randomBase36(6, () => 0), "000000");
  const id = generateId(fixed, () => 0.5);
  assert.match(id, /^20261026-[0-9a-z]{6}$/);
  assert.equal(isTravelId(id), true);
  assert.equal(isTravelId("2026102-abcdef"), false);
  assert.equal(dateStamp(fixed), "20261026");
});

test("dates: filename parsing and YYYY-MM-DD normalisation", () => {
  assert.equal(deriveDateFromFilename("2026-10-26-西湖.md"), "2026-10-26");
  assert.equal(deriveDateFromFilename("20261026 西湖.md"), "2026-10-26");
  assert.equal(deriveDateFromFilename("西湖.md"), null);
  assert.equal(deriveDateFromFilename("2026-13-40-假日期.md"), null);
  assert.equal(normalizeDate("2026-10-26T21:40:00+08:00"), "2026-10-26");
  assert.equal(normalizeDate("2026/1/6"), "2026-01-06");
  assert.equal(normalizeDate("不是日期"), null);
  assert.match(toLocalIsoString(new Date(2026, 9, 26, 21, 40, 0)), /^2026-10-26T21:40:00[+-]\d{2}:\d{2}$/);
});

test("WGS-84 to GCJ-02 stays within the known offset and round-trips", () => {
  const converted = wgs84ToGcj02(116.404, 39.915);
  assert.ok(Math.abs(converted.lng - 116.410_24) < 0.001);
  assert.ok(Math.abs(converted.lat - 39.916_4) < 0.001);
  const back = gcj02ToWgs84(converted.lng, converted.lat);
  assert.ok(Math.abs(back.lng - 116.404) < 0.000_01);
  assert.ok(Math.abs(back.lat - 39.915) < 0.000_01);
  const outside = wgs84ToGcj02(2.35, 48.85);
  assert.deepEqual(outside, { lng: 2.35, lat: 48.85 });
});

test("adcode rollup covers districts, cities, municipalities and direct counties", () => {
  assert.equal(normalizeAdcode("3301"), "330100");
  assert.equal(normalizeAdcode(33), "330000");
  assert.equal(normalizeAdcode("330106"), "330106");

  assert.deepEqual(rollup("330106"), {
    province: "330000",
    city: "330100",
    county: "330106",
    known: true,
    unsupported: false,
  });
  assert.equal(provinceNameOf("330106"), "浙江省");
  assert.equal(cityNameOf("330106"), "杭州市");

  const beijing = rollup("110105");
  assert.deepEqual(beijing, {
    province: "110000",
    city: "110000",
    county: "110105",
    known: true,
    unsupported: false,
  });
  assert.equal(rollup("110000").city, null);

  const jiyuan = rollup("419001");
  assert.deepEqual(jiyuan, {
    province: "410000",
    city: null,
    county: null,
    known: true,
    unsupported: false,
  });
  assert.equal(rollup("429004").province, "420000");
  assert.equal(rollup("659001").province, "650000");

  assert.equal(rollup("710000").unsupported, true);
  assert.equal(rollup("810000").unsupported, true);

  assert.equal(isKnownAdcode("330106"), true);
  assert.equal(isKnownAdcode("330199"), false);
  assert.equal(rollup("999999").known, false);
  assert.equal(adcodeFromNames("浙江省", "杭州"), "330100");
  assert.equal(adcodeFromNames("北京"), "110000");
});

test("media links are absolute or root-relative and parse back", () => {
  assert.equal(joinMediaPath("D:\\TravelMedia", "杭州/西湖/a.mp4"), "D:/TravelMedia/杭州/西湖/a.mp4");
  assert.equal(
    relativeMediaPath("D:/TravelMedia/杭州/西湖/a.mp4", "d:\\travelmedia\\"),
    "杭州/西湖/a.mp4"
  );

  const absolute = buildVideoLink("杭州/西湖/2026-10-26-01.mp4", {
    mediaRoot: "D:\\TravelMedia",
    mode: "absolute",
    label: "▶ 断桥日落",
  });
  assert.match(absolute, /^\[▶ 断桥日落\]\(<file:\/\/\/D:\/TravelMedia\//);
  const parsedAbsolute = extractVideoLinks(absolute, "D:\\TravelMedia");
  assert.equal(parsedAbsolute.length, 1);
  assert.equal(parsedAbsolute[0].resolved?.relative, "杭州/西湖/2026-10-26-01.mp4");
  assert.equal(
    resolveVideoHref("file:///D:/TravelMedia/x/y.mp4", "D:/TravelMedia")?.absolute,
    "D:/TravelMedia/x/y.mp4"
  );

  const relative = buildVideoLink("杭州/西湖/2026-10-26-01.mp4", {
    mediaRoot: "D:\\TravelMedia",
    mode: "relative",
  });
  assert.match(relative, /^\[▶ 2026-10-26 西湖\]\(local-file:\/\/\/%E6%9D%AD%E5%B7%9E/);
  const parsedRelative = extractVideoLinks(relative, "D:\\TravelMedia");
  assert.equal(
    parsedRelative[0].resolved?.absolute,
    "D:/TravelMedia/杭州/西湖/2026-10-26-01.mp4"
  );
  assert.equal(
    resolveVideoHref("local-file:///D:/TravelMedia/x/y.mp4", "D:/TravelMedia")?.relative,
    "x/y.mp4"
  );
  assert.equal(humanVideoLabel("2026-10-26-01"), "2026-10-26 01");

  assert.equal(isImageFile("a.JPG"), true);
  const photo = buildPhotoEmbed("杭州/西湖/01.jpg", {
    mediaRoot: "D:\\TravelMedia",
    mode: "absolute",
    label: "西湖",
  });
  assert.match(photo, /^!\[西湖\]\(<file:\/\/\/D:\/TravelMedia\//);
  assert.equal(
    resolveMediaField("D:\\TravelMedia\\杭州\\西湖\\01.jpg", "D:\\TravelMedia"),
    "D:/TravelMedia/杭州/西湖/01.jpg"
  );
  assert.equal(
    resolveMediaField("local-file:///杭州/西湖/01.jpg", "D:/TravelMedia"),
    "D:/TravelMedia/杭州/西湖/01.jpg"
  );
});

test("file names are sanitised and de-duplicated", () => {
  assert.equal(sanitizeFileName('西湖:*?"<>|'), "西湖");
  assert.equal(sanitizeFileName("  ..  "), "未命名");
  const taken = new Set(["西湖.md", "西湖-2.md"]);
  assert.equal(uniqueFileName("西湖", "md", (name) => taken.has(name)), "西湖-3.md");
  assert.equal(firstHeading("---\nkind: x\n---\n# 断桥\n正文"), "断桥");
});

test("visited calculation lights province and city, and reports unknown adcodes", () => {
  const state = computeVisitedState([
    { id: "a", name: "西湖", adcode: "330106", visited: true, hasJournals: false, lat: 30.2, lng: 120.1 },
    { id: "b", name: "外滩", adcode: "310101", visited: true, hasJournals: false },
    { id: "c", name: "乌镇", adcode: "330483", visited: false, hasJournals: true },
    { id: "d", name: "未去", adcode: "330106", visited: false, hasJournals: false },
    { id: "e", name: "错码", adcode: "999999", visited: true, hasJournals: false },
    { id: "f", name: "故宫", adcode: "110101", visited: true, hasJournals: false },
  ]);
  assert.equal(state.totalPlaces, 6);
  assert.equal(state.visitedCount, 5);
  assert.equal(state.provinceCounts.get("330000"), 2);
  assert.equal(state.cityCounts.get("330100"), 1);
  assert.equal(state.cityCounts.get("330400"), 1);
  assert.equal(state.cityCounts.get("310000"), 1);
  assert.equal(state.cityCounts.get("110000"), 1);
  assert.equal(state.countyCounts.get("330106"), 1);
  assert.equal(state.countyCounts.get("330483"), 1);
  assert.equal(state.countyCounts.get("310101"), 1);
  assert.equal(state.countyCounts.get("110101"), 1);
  assert.equal(state.countyCounts.size, 4);
  assert.equal(state.unknown.length, 1);
  assert.equal(state.unknown[0].name, "错码");
  assert.equal(state.locatedCount, 1);
});

function item(partial: Partial<TimelineItem> & { id: string; title: string }): TimelineItem {
  return {
    filePath: `${partial.id}.md`,
    placeId: "p",
    placeName: "西湖",
    tags: [],
    pinned: false,
    excerpt: "",
    mtime: 0,
    ...partial,
  };
}

test("map color settings accept hex colors and fall back for invalid values", () => {
  const settings = sanitizeSettings({
    mapProvinceColor: "#112233",
    mapCityColor: "not-a-color",
    mapCountyColor: "#ABCDEF",
    mapPlaceColor: undefined,
  });
  assert.equal(settings.mapProvinceColor, "#112233");
  assert.equal(settings.mapCityColor, "#10b981");
  assert.equal(settings.mapCountyColor, "#abcdef");
  assert.equal(settings.mapPlaceColor, "#ef4444");
});

test("timeline sorting puts pinned first and dates descending", () => {
  const sorted = sortTimeline([
    item({ id: "1", title: "旧", visitedStart: "2025-01-01", mtime: 2 }),
    item({ id: "2", title: "新", visitedStart: "2026-10-26", mtime: 1 }),
    item({ id: "3", title: "置顶", visitedStart: "2020-01-01", pinned: true, mtime: 3 }),
    item({ id: "4", title: "无日期", mtime: 100 }),
  ]);
  assert.deepEqual(
    sorted.map((entry) => entry.title),
    ["置顶", "新", "旧", "无日期"]
  );
  assert.equal(
    filterTimeline(sorted, { city: "杭州市" }).length,
    0
  );
  assert.equal(filterTimeline(sorted, { query: "置顶" }).length, 1);
});

test("path dates pick the most specific folder date", () => {
  assert.equal(
    deriveDateFromPath("2026.7.24-example/2026.8.18/note.txt"),
    "2026-08-18"
  );
  assert.equal(
    deriveDateFromPath("2026.7.24-example/expenses.txt"),
    "2026-07-24"
  );
  assert.equal(deriveDateFromPath("2026.13.40 坏日期/x.txt"), null);
  assert.equal(deriveDateFromPath("not a date"), null);
});

test("mixed import inventory classifies notes, media and documents", () => {
  assert.equal(classifyImportFile("a.md"), "markdown");
  assert.equal(classifyImportFile("a.txt"), "text");
  assert.equal(classifyImportFile("a.JPG"), "image");
  assert.equal(classifyImportFile("a.mp4"), "video");
  assert.equal(classifyImportFile("a.docx"), "document");
  assert.equal(classifyImportFile("a.canvas"), "other");

  const inventory = emptyInventory();
  for (const name of ["a.md", "b.txt", "c.jpg", "d.mp4", "e.pdf", "f.canvas"]) {
    addToInventory(inventory, classifyImportFile(name));
  }
  assert.deepEqual(inventory, {
    markdown: 1,
    text: 1,
    images: 1,
    videos: 1,
    documents: 1,
    other: 1,
    total: 6,
  });
  assert.match(inventorySummary(inventory), /照片 1.*视频 1/);
});

test("secrets are redacted from request/error text", () => {
  const url = redactSecrets(
    "GET https://restapi.amap.com/v3/place/text?key=abc123def456&keywords=西湖"
  );
  assert.equal(url.includes("abc123def456"), false);
  assert.equal(url.includes("[redacted]"), true);

  const json = redactSecrets('{"webKey":"secret-value","jsKey":"another"}');
  assert.equal(json.includes("secret-value"), false);
  assert.equal(json.includes("another"), false);
  assert.equal(safeErrorMessage(new Error("boom?key=leak")), "boom?key=[redacted]");
});

test("vault settings are whitelisted and key-like fields are dropped", () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const settings = sanitizeSettings({
      baseFolder: " 旅游 ",
      mediaRoot: "D:\\TravelMedia",
      amapConfigPath: "D:\\TravelMap\\amap-keys.json",
      sessionSearchLimit: 999,
      mapMode: "bad",
      mediaLinkMode: "bad",
      webKey: "must-not-survive",
      jsKey: "must-not-survive",
    });
    assert.equal(settings.baseFolder, "旅游");
    assert.equal(settings.mediaRoot, "D:\\TravelMedia");
    assert.equal(settings.sessionSearchLimit, 500);
    assert.equal(settings.mapMode, "auto");
    assert.equal(settings.mediaLinkMode, "absolute");
    assert.equal("webKey" in settings, false);
    assert.equal("jsKey" in settings, false);
    const legacy = sanitizeSettings({ videoRoot: "D:\\LegacyMedia" });
    assert.equal(legacy.mediaRoot, "D:\\LegacyMedia");
  } finally {
    console.warn = originalWarn;
  }
});

test("isPathInside distinguishes the vault from its parent", () => {
  const base = path.resolve("D:\\Vault");
  assert.equal(isPathInside(base, path.join(base, "amap-keys.json")), true);
  assert.equal(isPathInside(base, path.resolve("D:\\amap-keys.json")), false);
});

function amapPoi(
  name: string,
  typecode: string,
  overrides: Partial<AmapPoi> = {}
): AmapPoi {
  return {
    id: name,
    name,
    typecode,
    location: "120.1,30.2",
    cityname: "杭州市",
    adcode: "330106",
    ...overrides,
  };
}

test("Amap ranking filters commercial noise and marks sub-spots", () => {
  const ranked = rankPois(
    [
      amapPoi("示例湖公园", "110202"),
      amapPoi("示例湖公园-湖滨", "110101"),
      amapPoi("示例湖公园停车场", "150904"),
      amapPoi("示例百货(示例店)", "060101"),
      amapPoi("示例湖公园-花园", "110200"),
    ],
    "示例湖",
    "示例市"
  );
  assert.equal(ranked[0].name, "示例湖公园");
  assert.equal(ranked.some((poi) => poi.name.includes("停车场")), false);
  assert.equal(ranked.some((poi) => poi.name.includes("示例百货")), false);
  const sub = ranked.find((poi) => poi.name.includes("湖滨"));
  assert.ok(sub);
  assert.equal(sub.isSubPoi, true);
  assert.equal(queryMatchesSubSuffix(sub, "示例湖"), false);
  assert.equal(queryMatchesSubSuffix(sub, "湖滨"), true);

  const full = rankPois(
    [
      amapPoi("示例博物馆", "110201", { cityname: "示例市", adcode: "110101" }),
      amapPoi("示例博物馆-东门", "110200", { cityname: "示例市", adcode: "110101" }),
      amapPoi("示例博物馆-展厅", "110200", { cityname: "示例市", adcode: "110101" }),
    ],
    "示例",
    "示例市"
  );
  assert.equal(full[0].name, "示例博物馆");
  assert.equal(full[1].isSubPoi, true);
});

test("Amap ranking prefers the main example museum and drops ticketing/offices", () => {
  const ranked = rankPois(
    [
      amapPoi("示例博物馆", "110202", { cityname: "示例市", adcode: "110101" }),
      amapPoi("示例博物馆-展厅", "110200", { cityname: "示例市", adcode: "110101" }),
      amapPoi("示例博物馆-售票处", "110000", { cityname: "示例市", adcode: "110101" }),
      amapPoi("示例博物馆纪念品超市", "060000|110000", {
        cityname: "示例市",
        adcode: "110101",
      }),
      amapPoi("示例博物馆购物街", "110200", {
        cityname: "示例市",
        adcode: "110101",
      }),
      amapPoi("示例博物馆商业街", "110000", {
        cityname: "示例市",
        adcode: "110101",
      }),
      amapPoi("示例博物馆连接线", "110000", {
        cityname: "示例市",
        adcode: "110101",
      }),
      amapPoi("示例博物馆办公室", "140100", {
        cityname: "示例市",
        adcode: "110101",
      }),
    ],
    "示例博物馆",
    "示例市"
  );
  for (const noise of ["售票处", "纪念品超市", "购物街", "商业街", "连接线", "办公室"]) {
    assert.equal(ranked.some((poi) => poi.name.includes(noise)), false);
  }
});

test("Amap suggestions drop parking and malls", () => {
  const filtered = filterSuggestions(
    [
      { name: "示例湖公园", typecode: "110202", adcode: "110101" },
      { name: "示例湖公园停车场", typecode: "150904", adcode: "110101" },
      { name: "示例百货(示例店)", typecode: "060101", adcode: "110101" },
      { name: "示例湖", typecode: "190205", adcode: "110101" },
    ],
    "示例湖"
  );
  assert.deepEqual(
    filtered.map((item) => item.name),
    ["示例湖公园", "示例湖"]
  );
});
