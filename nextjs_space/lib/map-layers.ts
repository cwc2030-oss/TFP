export interface MapLayerConfig {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  dataSource: string;
  isAvailable: boolean;
  isPremium: boolean;
  wmsUrl?: string;
  wmsLayers?: string;
  color?: string;
  icon?: string;
}

export const MAP_LAYERS: MapLayerConfig[] = [
  {
    id: "flood_zones",
    name: "flood_zones",
    displayName: "FEMA Flood Zones",
    description: "Official FEMA National Flood Hazard Layer showing flood risk zones (A, AE, X, etc.)",
    category: "Environmental",
    dataSource: "FEMA NFHL",
    isAvailable: true,
    isPremium: false,
    wmsUrl: "https://hazards.fema.gov/arcgis/rest/services/public/NFHLWMS/MapServer/WMSServer",
    wmsLayers: "28",
    color: "#3B82F6",
    icon: "Waves",
  },
  {
    id: "wetlands",
    name: "wetlands",
    displayName: "Wetlands",
    description: "National Wetlands Inventory showing wetland boundaries and classifications",
    category: "Environmental",
    dataSource: "U.S. Fish & Wildlife Service",
    isAvailable: true,
    isPremium: false,
    wmsUrl: "https://www.fws.gov/wetlands/arcgis/rest/services/Wetlands/MapServer",
    color: "#10B981",
    icon: "Droplets",
  },
  {
    id: "topography",
    name: "topography",
    displayName: "Topography & Elevation",
    description: "Terrain elevation data and contour lines from USGS",
    category: "Physical",
    dataSource: "USGS",
    isAvailable: true,
    isPremium: false,
    color: "#8B5CF6",
    icon: "Mountain",
  },
  {
    id: "soil_types",
    name: "soil_types",
    displayName: "Soil Types",
    description: "USDA soil classification and characteristics",
    category: "Environmental",
    dataSource: "USDA NRCS",
    isAvailable: true,
    isPremium: false,
    wmsUrl: "https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms",
    color: "#D97706",
    icon: "Layers",
  },
  {
    id: "zoning",
    name: "zoning",
    displayName: "Zoning Information",
    description: "Local zoning designations and land use classifications",
    category: "Administrative",
    dataSource: "Local Government",
    isAvailable: true,
    isPremium: true,
    color: "#EC4899",
    icon: "LayoutGrid",
  },
  {
    id: "property_boundaries",
    name: "property_boundaries",
    displayName: "Property Boundaries",
    description: "Parcel boundaries and property lines",
    category: "Administrative",
    dataSource: "County Assessor",
    isAvailable: true,
    isPremium: false,
    color: "#F59E0B",
    icon: "Square",
  },
  {
    id: "power_substations",
    name: "power_substations",
    displayName: "Power Substations",
    description: "Electrical substations and major power infrastructure",
    category: "Infrastructure",
    dataSource: "EIA / Utility Companies",
    isAvailable: true,
    isPremium: true,
    color: "#EF4444",
    icon: "Zap",
  },
  {
    id: "roads_transportation",
    name: "roads_transportation",
    displayName: "Roads & Transportation",
    description: "Road networks, highways, and transportation infrastructure",
    category: "Infrastructure",
    dataSource: "OpenStreetMap",
    isAvailable: true,
    isPremium: false,
    color: "#6B7280",
    icon: "Route",
  },
];

export const LAYER_CATEGORIES = [
  { name: "Environmental", description: "Natural features and environmental data" },
  { name: "Physical", description: "Terrain and physical characteristics" },
  { name: "Infrastructure", description: "Utilities and transportation" },
  { name: "Administrative", description: "Boundaries and zoning" },
];
