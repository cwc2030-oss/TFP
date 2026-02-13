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
  }

  export interface MapLayerMouseEvent {
    lngLat: LngLatLike;
    features?: Array<{
      properties: Record<string, any>;
      geometry: any;
    }>;
  }

  export class Map {
    constructor(options: MapOptions);
    on(event: string, callback: (...args: any[]) => void): void;
    on(event: string, layer: string, callback: (...args: any[]) => void): void;
    addSource(id: string, source: any): void;
    addLayer(layer: any, before?: string): void;
    getSource(id: string): any;
    getLayer(id: string): any;
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
    getCanvas(): HTMLCanvasElement;
    addControl(control: any, position?: string): void;
    remove(): void;
  }

  export class Marker {
    constructor(options?: any);
    setLngLat(lnglat: [number, number] | LngLatLike): this;
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
