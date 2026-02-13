declare module 'mapbox-gl' {
  export interface LngLatLike {
    lng: number;
    lat: number;
  }

  export interface MapOptions {
    container: HTMLElement | string;
    style: string;
    center?: [number, number];
    zoom?: number;
    pitch?: number;
    bearing?: number;
    antialias?: boolean;
  }

  export interface MapLayerMouseEvent {
    lngLat: LngLatLike;
    features?: Array<{
      properties?: Record<string, any>;
    }>;
  }

  export class Map {
    constructor(options: MapOptions);
    on(type: string, listener: (ev: any) => void): this;
    on(type: string, layer: string, listener: (ev: MapLayerMouseEvent) => void): this;
    addSource(id: string, source: any): this;
    addLayer(layer: any): this;
    setTerrain(options: any): this;
    getLayer(id: string): any;
    setLayoutProperty(layer: string, name: string, value: any): this;
    flyTo(options: any): this;
    easeTo(options: any): this;
    getBearing(): number;
    setBearing(bearing: number): this;
    getPitch(): number;
    getCanvas(): HTMLCanvasElement;
    addControl(control: any, position?: string): this;
    remove(): void;
  }

  export class Marker {
    constructor(options?: { color?: string });
    setLngLat(lnglat: [number, number]): this;
    addTo(map: Map): this;
  }

  export class Popup {
    setLngLat(lnglat: LngLatLike): this;
    setHTML(html: string): this;
    addTo(map: Map): this;
  }

  export class NavigationControl {
    constructor(options?: { visualizePitch?: boolean });
  }

  export let accessToken: string;
}
