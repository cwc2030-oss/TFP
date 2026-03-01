declare module 'mapbox-gl' {
  export interface LngLatLike {
    lng: number;
    lat: number;
  }

  export interface MapOptions {
    container: HTMLElement;
    style: string;
    center: [number, number];
    zoom: number;
    pitch?: number;
    bearing?: number;
    antialias?: boolean;
    attributionControl?: boolean;
    preserveDrawingBuffer?: boolean;
  }

  export interface Point {
    x: number;
    y: number;
  }

  export interface MapLayerMouseEvent {
    lngLat: LngLatLike;
    point: Point;
    features?: Array<{
      properties: Record<string, any>;
      geometry: any;
    }>;
  }

  // Aliases for compatibility
  export type MapMouseEvent = MapLayerMouseEvent;
  export type MapboxGeoJSONFeature = {
    properties: Record<string, any>;
    geometry: any;
  };

  // Style types
  export interface StyleLayer {
    id: string;
    type: string;
    source?: string;
    paint?: Record<string, any>;
    layout?: Record<string, any>;
  }

  export interface Style {
    layers?: StyleLayer[];
  }

  // GeoJSON Source interface
  export interface GeoJSONSource {
    setData(data: GeoJSON.GeoJSON): void;
  }

  export class LngLatBounds {
    constructor(sw?: LngLatLike | [number, number], ne?: LngLatLike | [number, number]);
    extend(lngLat: LngLatLike | [number, number]): this;
    getCenter(): LngLatLike;
    getSouthWest(): LngLatLike;
    getNorthEast(): LngLatLike;
    toArray(): [[number, number], [number, number]];
  }

  export class Map {
    constructor(options: MapOptions);
    on(event: string, callback: (...args: any[]) => void): void;
    on(event: string, layer: string, callback: (...args: any[]) => void): void;
    once(event: string, callback: (...args: any[]) => void): void;
    off(event: string, callback: (...args: any[]) => void): void;
    off(event: string, layer: string, callback: (...args: any[]) => void): void;
    addSource(id: string, source: any): void;
    addLayer(layer: any, before?: string): void;
    removeLayer(id: string): void;
    removeSource(id: string): void;
    getSource(id: string): GeoJSONSource | any;
    getLayer(id: string): StyleLayer | undefined;
    getStyle(): Style | undefined;
    setLayoutProperty(layerId: string, name: string, value: any): void;
    setPaintProperty(layerId: string, name: string, value: any): void;
    setTerrain(terrain: any): void;
    getBearing(): number;
    setBearing(bearing: number): void;
    getPitch(): number;
    setPitch(pitch: number): void;
    getZoom(): number;
    setZoom(zoom: number): void;
    flyTo(options: any): void;
    easeTo(options: any): void;
    fitBounds(bounds: LngLatBounds | [[number, number], [number, number]], options?: { padding?: number | { top?: number; bottom?: number; left?: number; right?: number }; duration?: number; pitch?: number; bearing?: number; maxZoom?: number; essential?: boolean }): this;
    getCanvas(): HTMLCanvasElement;
    addControl(control: any, position?: string): void;
    isStyleLoaded(): boolean;
    loaded(): boolean;
    getCenter(): LngLatLike;
    queryRenderedFeatures(point: Point | [Point, Point], options?: { layers?: string[]; filter?: any[] }): MapboxGeoJSONFeature[];
    remove(): void;
  }

  export class Marker {
    constructor(options?: any);
    setLngLat(lnglat: [number, number] | LngLatLike): this;
    setPopup(popup: Popup): this;
    getPopup(): Popup | undefined;
    getElement(): HTMLElement;
    addTo(map: Map): this;
    remove(): void;
  }

  export class Popup {
    constructor(options?: any);
    setLngLat(lnglat: [number, number] | LngLatLike): this;
    setHTML(html: string): this;
    addTo(map: Map): this;
    remove(): void;
  }

  export class NavigationControl {
    constructor(options?: { showCompass?: boolean; showZoom?: boolean; visualizePitch?: boolean });
  }

  export let accessToken: string;
}
