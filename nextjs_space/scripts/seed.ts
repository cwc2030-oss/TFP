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
      description: "Official FEMA National Flood Hazard Layer showing flood risk zones (A, AE, X, etc.)",
      category: "Environmental",
      source: "FEMA NFHL",
      isAvailable: true,
      isPremium: false,
    },
    {
      name: "wetlands",
      description: "National Wetlands Inventory showing wetland boundaries and classifications",
      category: "Environmental",
      source: "U.S. Fish & Wildlife Service",
      isAvailable: true,
      isPremium: false,
    },
    {
      name: "topography",
      description: "Terrain elevation data and contour lines from USGS",
      category: "Physical",
      source: "USGS",
      isAvailable: true,
      isPremium: false,
    },
    {
      name: "soil_types",
      description: "USDA soil classification and characteristics",
      category: "Environmental",
      source: "USDA NRCS",
      isAvailable: true,
      isPremium: false,
    },
    {
      name: "zoning",
      description: "Local zoning designations and land use classifications",
      category: "Administrative",
      source: "Local Government",
      isAvailable: true,
      isPremium: true,
    },
    {
      name: "property_boundaries",
      description: "Parcel boundaries and property lines",
      category: "Administrative",
      source: "County Assessor",
      isAvailable: true,
      isPremium: false,
    },
    {
      name: "power_substations",
      description: "Electrical substations and major power infrastructure",
      category: "Infrastructure",
      source: "EIA / Utility Companies",
      isAvailable: true,
      isPremium: true,
    },
    {
      name: "roads_transportation",
      description: "Road networks, highways, and transportation infrastructure",
      category: "Infrastructure",
      source: "OpenStreetMap",
      isAvailable: true,
      isPremium: false,
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
