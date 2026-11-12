import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

// Load apps/api/.env when running locally; ignored when absent (Docker sets the variables directly).
try {
  process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  // rely on the process environment
}

const prisma = new PrismaClient();

/**
 * Example saved views for a fresh install. They refer to indicators and countries
 * that the World Bank ingest loads; SavedView has no foreign keys, so the order in
 * which seeding and ingesting run does not matter.
 */
const EXAMPLE_VIEWS = [
  {
    name: "G7 GDP per capita",
    indicatorCode: "NY.GDP.PCAP.CD",
    year: null, // follow the latest year
    countries: "USA,JPN,DEU,GBR,FRA,ITA,CAN",
    order: "DESC",
    region: null,
  },
  {
    name: "Life expectancy in Europe, 2019",
    indicatorCode: "SP.DYN.LE00.IN",
    year: 2019,
    countries: "ESP,ITA,FRA,DEU,GBR,POL",
    order: "DESC",
    region: "Europe & Central Asia",
  },
  {
    name: "BRICS internet users, lowest first",
    indicatorCode: "IT.NET.USER.ZS",
    year: 2015,
    countries: "BRA,RUS,IND,CHN,ZAF",
    order: "ASC",
    region: null,
  },
];

async function main() {
  // Greetings mark a database as seeded. The example views are only added along
  // with them, on a fresh database, so that views a user has deleted do not come
  // back the next time the app starts.
  const count = await prisma.greeting.count();
  if (count > 0) {
    console.log(`Database already seeded (${count} greetings). Skipping.`);
    return;
  }

  await prisma.greeting.createMany({
    data: [
      { message: "Hello, World!" },
      { message: "Hello from SQLite via Prisma" },
      { message: "Hello from the GraphQL API" },
    ],
  });

  console.log("Seeded 3 greetings.");

  // The names are unique, so skip any that somehow exist already rather than fail.
  const existing = new Set((await prisma.savedView.findMany({ select: { name: true } })).map((v) => v.name));
  const views = EXAMPLE_VIEWS.filter((v) => !existing.has(v.name));
  await prisma.savedView.createMany({ data: views });

  console.log(`Seeded ${views.length} example saved views.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
