/**
 * Canonical Flow Contract (v5.0-scope)
 * ------------------------------------
 * THIS IS THE ONE LOCKED CANONICAL FLOW RESPONSE SHAPE.
 *
 * Every flow producer emits it and every flow consumer reads it. Do not fork,
 * duplicate, or redefine these shapes elsewhere — import from here.
 *
 * The canonical shape is intentionally flat and render-agnostic:
 *   flow_lines: [{ id, points:[{lat,lng}], tier, confidence }]
 *   scope:      { center:{lat,lng}, radius_m, acres, mode }
 *   engine_version: string
 *
 * NOTE (Piece 0 — plumbing only): this contract is emitted ADDITIVELY alongside
 * the existing GeoJSON flow fields (flow_primary / flow_secondary / etc). No
 * rendering or counting logic reads from it yet. Consumer migration onto
 * flow_lines happens in later pieces.
 */

/** Confidence tier color. Derived from confidence, not stored separately. */
export type FlowTierColor = 'green' | 'blue' | 'black';

/** A single {lat,lng} coordinate. Canonical order is lat-first. */
export interface FlowPoint {
  lat: number;
  lng: number;
}

/** One canonical flow line. */
export interface FlowLine {
  /** Stable identifier for this flow line. */
  id: string;
  /** Ordered polyline vertices (lat/lng). */
  points: FlowPoint[];
  /** Confidence tier color: green >=0.66, blue 0.33-0.66, black <0.33. */
  tier: FlowTierColor;
  /** Movement likelihood / confidence, 0..1. */
  confidence: number;
}

/** Analysis scope mode: single parcel today, radius-based zone later. */
export type FlowScopeMode = 'parcel' | 'zone';

/** The spatial scope the flow_lines were computed for. */
export interface FlowScope {
  /** Scope center (analysis origin). */
  center: FlowPoint;
  /** Analysis radius in meters. */
  radius_m: number;
  /** Scope area in acres. */
  acres: number;
  /** parcel = single-parcel analysis; zone = radius-based zone analysis. */
  mode: FlowScopeMode;
}

/** The canonical flow response envelope emitted by every flow producer. */
export interface CanonicalFlowResponse {
  flow_lines: FlowLine[];
  scope: FlowScope;
  engine_version: string;
}
