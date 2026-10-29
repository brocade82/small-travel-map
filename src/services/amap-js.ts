export interface AmapNamespace {
  Map: new (container: HTMLElement, options?: Record<string, unknown>) => AmapMapInstance;
  Marker: new (options?: Record<string, unknown>) => AmapMarkerInstance;
  plugin?: (plugins: string | string[], callback?: () => void) => void;
  [key: string]: unknown;
}

export interface AmapMapInstance {
  add: (overlay: unknown) => void;
  remove: (overlay: unknown) => void;
  setZoomAndCenter?: (zoom: number, center: [number, number]) => void;
  setFitView?: (overlays?: unknown[], immediately?: boolean, avoid?: number[]) => void;
  destroy: () => void;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
}

export interface AmapMarkerInstance {
  setMap?: (map: AmapMapInstance | null) => void;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  setPosition?: (position: [number, number]) => void;
}

declare global {
  interface Window {
    AMap?: AmapNamespace;
    _AMapSecurityConfig?: { securityJsCode?: string };
  }
}

let loadPromise: Promise<AmapNamespace> | null = null;

export function hasAmap(): boolean {
  return Boolean(window.AMap && window.AMap.Map);
}

/**
 * Loads AMap JS API 2.0 from the official CDN. The API must be loaded online
 * and is therefore optional (the offline overview is the fallback).
 */
export function loadAmapJs(
  jsKey: string | undefined,
  securityCode: string | undefined,
  timeoutMs = 12_000
): Promise<AmapNamespace> {
  if (hasAmap()) return Promise.resolve(window.AMap as AmapNamespace);
  if (!jsKey) {
    return Promise.reject(new Error("未配置高德 JS API Key"));
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<AmapNamespace>((resolve, reject) => {
    if (securityCode) {
      window._AMapSecurityConfig = { securityJsCode: securityCode };
    }
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(jsKey)}`;
    script.async = true;
    script.dataset.travelMapAmap = "true";

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("高德 JS API 加载超时（12 秒）"));
    }, timeoutMs);

    const cleanup = () => {
      window.clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
    };

    script.onload = () => {
      cleanup();
      if (hasAmap()) {
        resolve(window.AMap as AmapNamespace);
      } else {
        reject(new Error("高德 JS API 脚本已加载，但 AMap 命名空间不可用"));
      }
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("高德 JS API 脚本加载失败（网络或域名限制）"));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    loadPromise = null;
    throw error;
  });

  return loadPromise;
}

export function resetAmapLoader(): void {
  loadPromise = null;
  for (const script of Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[data-travel-map-amap="true"]')
  )) {
    script.remove();
  }
}
