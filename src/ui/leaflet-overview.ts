import type * as Leaflet from "leaflet";
import fs from "node:fs";
import path from "node:path";
import { setIcon } from "obsidian";
import type TravelMapPlugin from "../main";
import { shortRegionName } from "../core/regions";
import type { VisitedState } from "../core/visited";

export type OfflineSelectionLevel = "province" | "city" | "county" | "place";

export interface OfflineSelection {
  level: OfflineSelectionLevel;
  adcode?: string;
  placeId?: string;
  name?: string;
}

export interface OfflineOverviewOptions {
  state: VisitedState;
  logsCount: number;
  onSelect: (selection: OfflineSelection) => void;
}

export interface OfflineOverviewHandle {
  update(state: VisitedState): void;
  invalidateSize(): void;
  destroy(): void;
}

interface AdminProperties {
  adcode: string;
  name: string;
  level: string;
  provinceCode?: string;
  cityCode?: string | null;
  center?: [number, number] | null;
  childrenNum?: number;
}

interface AdminFeature {
  type: "Feature";
  properties: AdminProperties;
  geometry: GeoJSON.Geometry;
}

interface AdminCollection {
  type: "FeatureCollection";
  features: AdminFeature[];
}

function mapPackDirectory(plugin: TravelMapPlugin): string {
  const vaultBase =
    (plugin.app.vault.adapter as unknown as { getBasePath?: () => string }).getBasePath?.() ??
    "";
  const rawDir = plugin.settings.mapPackDir.trim();
  if (rawDir) {
    return path.isAbsolute(rawDir) ? rawDir : path.join(vaultBase, rawDir);
  }
  const manifestDir = (plugin.manifest as unknown as { dir?: string }).dir;
  const pluginDir = manifestDir
    ? path.isAbsolute(manifestDir)
      ? manifestDir
      : path.join(vaultBase, manifestDir)
    : path.join(vaultBase, ".obsidian", "plugins", "travel-map");
  return path.join(pluginDir, "assets", "geo");
}

function readMapPack(plugin: TravelMapPlugin, name: string): AdminCollection {
  const file = path.join(mapPackDirectory(plugin), name);
  if (!fs.existsSync(file)) {
    throw new Error(
      `找不到地图包文件 ${name}。请在「设置 → 旅游地图 → 地图包目录」指定包含三个 GeoJSON 的目录；本插件不附带边界数据。`
    );
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as AdminCollection;
  } catch (error) {
    throw new Error(`地图包文件无法解析：${file}（${(error as Error).message}）`);
  }
}

type LeafletModule = typeof import("leaflet");
let leafletPromise: Promise<LeafletModule> | null = null;

async function loadLeaflet(): Promise<LeafletModule> {
  if (!leafletPromise) {
    leafletPromise = import("leaflet").then((module) => {
      const candidate = module as unknown as { default?: LeafletModule };
      return (candidate.default ?? (module as unknown as LeafletModule)) as LeafletModule;
    });
  }
  return leafletPromise;
}

function intensity(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 4) return 2;
  return 3;
}

interface MapPalette {
  province: string;
  city: string;
  county: string;
  place: string;
}

function paletteFromSettings(plugin: TravelMapPlugin): MapPalette {
  return {
    province: plugin.settings.mapProvinceColor,
    city: plugin.settings.mapCityColor,
    county: plugin.settings.mapCountyColor,
    place: plugin.settings.mapPlaceColor,
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mix toward white when amount > 0, toward black when amount < 0. */
function shade(hex: string, amount: number): string {
  const target = amount >= 0 ? 255 : 0;
  const ratio = Math.abs(amount);
  const rgb = hexToRgb(hex).map((value) => value + (target - value) * ratio);
  return rgbToHex(rgb as [number, number, number]);
}

function provinceStyle(
  count: number,
  selected: boolean,
  unsupported: boolean,
  zoom: number,
  palette: MapPalette
): Leaflet.PathOptions {
  if (unsupported) {
    return {
      color: "#94a3b8",
      weight: 0.7,
      fillColor: "#e2e8f0",
      fillOpacity: 0.12,
      dashArray: "3 3",
    };
  }
  const level = intensity(count);
  const baseOpacity = level === 0 ? 0.28 : level === 1 ? 0.52 : level === 2 ? 0.64 : 0.74;
  const fillWhite = level === 0 ? 0.76 : level === 1 ? 0.52 : level === 2 ? 0.3 : 0.12;
  return {
    color: selected ? shade(palette.province, -0.25) : "#64748b",
    weight: selected ? 2.4 : 0.8,
    fillColor: shade(palette.province, fillWhite),
    // Once city/county layers are visible, province fill must recede so the
    // three administrative levels do not read as one colored surface.
    fillOpacity: zoom >= 5 ? baseOpacity * 0.12 : baseOpacity,
  };
}

function cityStyle(
  count: number,
  selected: boolean,
  zoom: number,
  palette: MapPalette
): Leaflet.PathOptions {
  return {
    color: selected ? shade(palette.city, -0.25) : count > 0 ? palette.city : "#94a3b8",
    weight: selected ? 2.1 : count > 0 ? 1.35 : 0.55,
    fill: count > 0,
    fillColor: palette.city,
    fillOpacity: selected ? 0.28 : count > 0 ? (zoom >= 5 ? 0.12 : 0.2) : 0,
    opacity: count > 0 ? 0.95 : 0.6,
  };
}

function countyStyle(
  count: number,
  selected: boolean,
  palette: MapPalette
): Leaflet.PathOptions {
  return {
    color: selected ? shade(palette.county, -0.25) : count > 0 ? palette.county : "#cbd5e1",
    weight: selected ? 2.2 : count > 0 ? 1.05 : 0.4,
    fillColor: count > 0 ? shade(palette.county, count >= 5 ? 0.05 : 0.28) : "#ffffff",
    fillOpacity: selected ? 0.78 : count > 0 ? 0.6 : 0,
  };
}

function markerColors(palette: MapPalette): { color: string; fillColor: string } {
  return { color: shade(palette.place, -0.25), fillColor: palette.place };
}

function centerOf(L: LeafletModule, feature: AdminFeature): Leaflet.LatLng | null {
  const center = feature.properties.center;
  if (!Array.isArray(center) || center.length < 2) return null;
  return L.latLng(center[1], center[0]);
}

function labelIcon(L: LeafletModule, text: string, lit: boolean): Leaflet.DivIcon {
  return L.divIcon({
    className: lit
      ? "travel-leaflet-label travel-leaflet-label--lit"
      : "travel-leaflet-label",
    html: `<span>${text.replace(/[<>&]/g, "")}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

/**
 * Leaflet offline administrative map. It deliberately has no tile layer:
 * province/city/county polygons come from a user-selected local map pack,
 * so zooming never makes a network request.
 */
export async function createOfflineOverview(
  container: HTMLElement,
  plugin: TravelMapPlugin,
  options: OfflineOverviewOptions
): Promise<OfflineOverviewHandle> {
  const provinces = readMapPack(plugin, "china-provinces.geojson");
  const cities = readMapPack(plugin, "china-cities.geojson");
  const counties = readMapPack(plugin, "china-counties.geojson");
  const L = await loadLeaflet();
  let state = options.state;

  container.empty();
  container.addClass("travel-leaflet");
  container.createDiv({
    cls: "travel-leaflet-hint",
    text: "滚轮缩放查看市/区县 · 点击区县看日志",
  });
  const mapEl = container.createDiv({ cls: "travel-leaflet__map" });
  const map = L.map(mapEl, {
    minZoom: 3,
    maxZoom: 9,
    zoomControl: true,
    attributionControl: false,
    preferCanvas: true,
    zoomSnap: 0.5,
    wheelPxPerZoomLevel: 90,
  });
  map.setView([35.5, 104], 3.5);

  map.createPane("provincePane").style.zIndex = "410";
  map.createPane("cityPane").style.zIndex = "420";
  map.createPane("countyPane").style.zIndex = "430";
  map.createPane("placePane").style.zIndex = "620";

  L.control
    .attribution({ position: "bottomright", prefix: false })
    .addAttribution("行政边界 © 地图包提供者（用户自备）")
    .addTo(map);

  const legend = container.createDiv({ cls: "travel-leaflet-legend" });
  const legendSwatches = new Map<string, HTMLElement>();
  for (const label of ["省", "市", "区县", "地点"]) {
    const item = legend.createDiv({ cls: "travel-leaflet-legend__item" });
    const swatch = item.createSpan({ cls: "travel-leaflet-legend__swatch" });
    item.createSpan({ text: label });
    legendSwatches.set(label, swatch);
  }
  let palette = paletteFromSettings(plugin);
  const applyLegend = () => {
    const colors: Record<string, string> = {
      省: palette.province,
      市: palette.city,
      区县: palette.county,
      地点: palette.place,
    };
    for (const [label, swatch] of legendSwatches) {
      swatch.style.background = colors[label];
    }
  };
  applyLegend();

  const provinceByCode = new Map(
    provinces.features.map((feature) => [feature.properties.adcode, feature.properties])
  );
  const cityByCode = new Map(
    cities.features.map((feature) => [feature.properties.adcode, feature.properties])
  );
  const countyByCode = new Map(
    counties.features.map((feature) => [feature.properties.adcode, feature.properties])
  );

  let selectedKey = "";
  const provinceLayers = new Map<string, Leaflet.Path>();
  const cityLayers = new Map<string, Leaflet.Path>();
  const countyLayers = new Map<string, Leaflet.Path>();
  const placeMarkers = new Map<string, Leaflet.CircleMarker>();

  const isUnsupported = (adcode: string) =>
    adcode === "710000" || adcode === "810000" || adcode === "820000";

  const provinceStyleFor = (adcode: string) =>
    provinceStyle(
      state.provinceCounts.get(adcode) ?? 0,
      selectedKey === `province:${adcode}`,
      isUnsupported(adcode),
      map.getZoom(),
      palette
    );
  const cityStyleFor = (adcode: string) =>
    cityStyle(
      state.cityCounts.get(adcode) ?? 0,
      selectedKey === `city:${adcode}`,
      map.getZoom(),
      palette
    );
  const countyStyleFor = (adcode: string) =>
    countyStyle(
      state.countyCounts.get(adcode) ?? 0,
      selectedKey === `county:${adcode}`,
      palette
    );

  const attach = (
    layer: Leaflet.Layer,
    feature: AdminFeature,
    kind: "province" | "city" | "county"
  ) => {
    const adcode = feature.properties.adcode;
    const count =
      kind === "province"
        ? state.provinceCounts.get(adcode) ?? 0
        : kind === "city"
          ? state.cityCounts.get(adcode) ?? 0
          : state.countyCounts.get(adcode) ?? 0;
    const label = feature.properties.name || adcode;
    layer.bindTooltip(
      count > 0 ? `${label} · 点亮 ${count} 个地点` : label,
      { sticky: true, direction: "top", className: "travel-leaflet-tooltip" }
    );
    layer.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      selectedKey = `${kind}:${adcode}`;
      updateStyles();
      options.onSelect({ level: kind, adcode, name: label });
    });
  };

  const provinceLayer = L.geoJSON(provinces as unknown as GeoJSON.GeoJsonObject, {
    pane: "provincePane",
    style: (feature) => provinceStyleFor((feature as AdminFeature).properties.adcode),
    onEachFeature: (feature, layer) => {
      const admin = feature as AdminFeature;
      provinceLayers.set(admin.properties.adcode, layer as Leaflet.Path);
      attach(layer, admin, "province");
    },
  }).addTo(map);

  const cityLayer = L.geoJSON(cities as unknown as GeoJSON.GeoJsonObject, {
    pane: "cityPane",
    style: (feature) => cityStyleFor((feature as AdminFeature).properties.adcode),
    onEachFeature: (feature, layer) => {
      const admin = feature as AdminFeature;
      cityLayers.set(admin.properties.adcode, layer as Leaflet.Path);
      attach(layer, admin, "city");
    },
  });

  const countyLayer = L.geoJSON(counties as unknown as GeoJSON.GeoJsonObject, {
    pane: "countyPane",
    style: (feature) => countyStyleFor((feature as AdminFeature).properties.adcode),
    onEachFeature: (feature, layer) => {
      const admin = feature as AdminFeature;
      countyLayers.set(admin.properties.adcode, layer as Leaflet.Path);
      attach(layer, admin, "county");
    },
  });

  const provinceLabels = L.layerGroup().addTo(map);
  for (const feature of provinces.features) {
    const properties = feature.properties;
    if (properties.adcode === "810000" || properties.adcode === "820000") continue;
    const center = centerOf(L, feature);
    if (!center) continue;
    const count = state.provinceCounts.get(properties.adcode) ?? 0;
    const marker = L.marker(center, {
      icon: labelIcon(L, shortRegionName(properties.name), count > 0),
      interactive: false,
      keyboard: false,
      pane: "provincePane",
    });
    marker.addTo(provinceLabels);
  }

  const cityLabels = L.layerGroup();
  for (const feature of cities.features) {
    const center = centerOf(L, feature);
    if (!center) continue;
    const count = state.cityCounts.get(feature.properties.adcode) ?? 0;
    L.marker(center, {
      icon: labelIcon(L, shortRegionName(feature.properties.name), count > 0),
      interactive: false,
      keyboard: false,
      pane: "cityPane",
    }).addTo(cityLabels);
  }

  const countyLabels = L.layerGroup();
  const renderCountyLabels = () => {
    countyLabels.clearLayers();
    for (const [adcode] of state.countyCounts) {
      const feature = counties.features.find((item) => item.properties.adcode === adcode);
      const center = feature ? centerOf(L, feature) : null;
      if (!feature || !center) continue;
      L.marker(center, {
        icon: labelIcon(L, shortRegionName(feature.properties.name), true),
        interactive: false,
        keyboard: false,
        pane: "countyPane",
      }).addTo(countyLabels);
      if (map.hasLayer(countyLabels)) {
        // The layer group is already on the map; no extra work.
      }
    }
  };
  renderCountyLabels();

  const placeLayer = L.layerGroup().addTo(map);
  const renderPlaces = () => {
    placeLayer.clearLayers();
    placeMarkers.clear();
    for (const place of state.places) {
      if (
        typeof place.lat !== "number" ||
        typeof place.lng !== "number" ||
        !Number.isFinite(place.lat) ||
        !Number.isFinite(place.lng)
      ) {
        continue;
      }
      const colors = markerColors(palette);
      const marker = L.circleMarker([place.lat, place.lng], {
        pane: "placePane",
        radius: 5,
        color: colors.color,
        weight: 2,
        fillColor: colors.fillColor,
        fillOpacity: 0.95,
      });
      marker.bindTooltip(
        `${place.name}${place.journalCount ? ` · ${place.journalCount} 篇日志` : ""}`,
        { direction: "top", className: "travel-leaflet-tooltip" }
      );
      marker.on("click", (event) => {
        L.DomEvent.stopPropagation(event);
        options.onSelect({ level: "place", placeId: place.id, name: place.name });
      });
      marker.addTo(placeLayer);
      placeMarkers.set(place.id, marker);
    }
  };

  const updateStyles = () => {
    for (const [adcode, layer] of provinceLayers) layer.setStyle(provinceStyleFor(adcode));
    for (const [adcode, layer] of cityLayers) layer.setStyle(cityStyleFor(adcode));
    for (const [adcode, layer] of countyLayers) layer.setStyle(countyStyleFor(adcode));
  };

  const syncZoomLayers = () => {
    const zoom = map.getZoom();
    container.dataset.zoom = String(zoom);
    if (zoom >= 4 && !map.hasLayer(cityLayer)) cityLayer.addTo(map);
    if (zoom < 4 && map.hasLayer(cityLayer)) map.removeLayer(cityLayer);
    if (zoom >= 5 && !map.hasLayer(countyLayer)) countyLayer.addTo(map);
    if (zoom < 5 && map.hasLayer(countyLayer)) map.removeLayer(countyLayer);
    if (zoom >= 4.5 && !map.hasLayer(cityLabels)) cityLabels.addTo(map);
    if (zoom < 4.5 && map.hasLayer(cityLabels)) map.removeLayer(cityLabels);
    if (zoom >= 6.5 && !map.hasLayer(countyLabels)) countyLabels.addTo(map);
    if (zoom < 6.5 && map.hasLayer(countyLabels)) map.removeLayer(countyLabels);
    updateStyles();
    // Province labels remain useful while zoomed; county/city names are tooltips.
  };

  map.on("zoomend", syncZoomLayers);
  renderPlaces();
  syncZoomLayers();

  // Let Obsidian finish laying out the view before Leaflet measures it.
  window.setTimeout(() => map.invalidateSize(), 50);

  return {
    update(nextState: VisitedState) {
      state = nextState;
      palette = paletteFromSettings(plugin);
      applyLegend();
      updateStyles();
      renderPlaces();
      renderCountyLabels();
    },
    invalidateSize() {
      map.invalidateSize();
    },
    destroy() {
      map.off("zoomend", syncZoomLayers);
      map.remove();
      container.empty();
    },
  };
}

/** Fallback text shown if the offline assets cannot be loaded. */
export function renderOfflineMapError(container: HTMLElement, message: string): void {
  container.empty();
  container.addClass("travel-leaflet-error");
  const icon = container.createDiv({ cls: "travel-empty__icon" });
  setIcon(icon, "map-off");
  container.createDiv({ cls: "travel-empty__title", text: "离线地图暂时不可用" });
  container.createDiv({ cls: "travel-empty__hint", text: message });
}
