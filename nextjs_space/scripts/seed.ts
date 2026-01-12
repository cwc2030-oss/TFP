import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create admin user
  const adminPasswordHash = await bcrypt.hash("johndoe123", 12);
  await prisma.user.upsert({
    where: { email: "john@doe.com" },
    update: {},
    create: {
      email: "john@doe.com",
      passwordHash: adminPasswordHash,
      name: "John Doe",
      company: "Terra Firma Partners LLC",
      role: "admin",
    },
  });
  console.log("Admin user created");

  // Create map layers
  const mapLayers = [
    {
      name: "flood_zones",
      displayName: "FEMA Flood Zones",
      description: "Official FEMA National Flood Hazard Layer showing flood risk zones (A, AE, X, etc.)",
      category: "Environmental",
      dataSource: "FEMA NFHL",
      isAvailable: true,
      isPremium: false,
      sortOrder: 1,
    },
    {
      name: "wetlands",
      displayName: "Wetlands",
      description: "National Wetlands Inventory showing wetland boundaries and classifications",
      category: "Environmental",
      dataSource: "U.S. Fish & Wildlife Service",
      isAvailable: true,
      isPremium: false,
      sortOrder: 2,
    },
    {
      name: "topography",
      displayName: "Topography & Elevation",
      description: "Terrain elevation data and contour lines from USGS",
      category: "Physical",
      dataSource: "USGS",
      isAvailable: true,
      isPremium: false,
      sortOrder: 3,
    },
    {
      name: "soil_types",
      displayName: "Soil Types",
      description: "USDA soil classification and characteristics",
      category: "Environmental",
      dataSource: "USDA NRCS",
      isAvailable: true,
      isPremium: false,
      sortOrder: 4,
    },
    {
      name: "zoning",
      displayName: "Zoning Information",
      description: "Local zoning designations and land use classifications",
      category: "Administrative",
      dataSource: "Local Government",
      isAvailable: true,
      isPremium: true,
      sortOrder: 5,
    },
    {
      name: "property_boundaries",
      displayName: "Property Boundaries",
      description: "Parcel boundaries and property lines",
      category: "Administrative",
      dataSource: "County Assessor",
      isAvailable: true,
      isPremium: false,
      sortOrder: 6,
    },
    {
      name: "power_substations",
      displayName: "Power Substations",
      description: "Electrical substations and major power infrastructure",
      category: "Infrastructure",
      dataSource: "EIA / Utility Companies",
      isAvailable: true,
      isPremium: true,
      sortOrder: 7,
    },
    {
      name: "roads_transportation",
      displayName: "Roads & Transportation",
      description: "Road networks, highways, and transportation infrastructure",
      category: "Infrastructure",
      dataSource: "OpenStreetMap",
      isAvailable: true,
      isPremium: false,
      sortOrder: 8,
    },
  ];

  for (const layer of mapLayers) {
    await prisma.mapLayer.upsert({
      where: { name: layer.name },
      update: layer,
      create: layer,
    });
  }
  console.log("Map layers created");

  console.log("Database seeding completed!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
