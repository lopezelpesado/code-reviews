import { GraphQLError } from "graphql";
import { createSchema } from "graphql-yoga";
import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

export const typeDefs = /* GraphQL */ `
  type Greeting {
    id: Int!
    message: String!
    createdAt: String!
  }

  "A country as classified by the World Bank."
  type Country {
    "ISO 3166-1 alpha-3 code, e.g. GBR"
    code: String!
    "ISO 3166-1 alpha-2 code, e.g. GB"
    iso2Code: String!
    name: String!
    region: String!
    regionCode: String!
    incomeLevel: String!
    incomeLevelCode: String!
    capitalCity: String
    latitude: Float
    longitude: Float
    "Observations for this country, optionally filtered by indicator and year range."
    observations(indicatorCode: String, fromYear: Int, toYear: Int): [Observation!]!
  }

  "A World Bank data series, e.g. GDP per capita."
  type Indicator {
    code: String!
    name: String!
    sourceNote: String
    sourceOrganization: String
    lastFetchedAt: String
    "Number of stored observations for this indicator."
    observationCount: Int!
    "Earliest and latest year with data."
    yearRange: YearRange
    "Most recent year with data for at least 100 countries. Use this as a sensible default year."
    latestYear: Int
  }

  type YearRange {
    min: Int!
    max: Int!
  }

  "One indicator value for one country in one year."
  type Observation {
    id: Int!
    countryCode: String!
    indicatorCode: String!
    year: Int!
    value: Float!
    country: Country!
    indicator: Indicator!
  }

  "Row counts and freshness of the ingested dataset."
  type DataSummary {
    countries: Int!
    indicators: Int!
    observations: Int!
    regions: [String!]!
    incomeLevels: [String!]!
    lastIngestedAt: String
  }

  "Headline figures for the dashboard."
  type DashboardSummary {
    "Sum of the latest population figures across all countries."
    worldPopulation: Float!
    worldPopulationYear: Int!
    "Simple (unweighted) mean of life expectancy across countries."
    avgLifeExpectancy: Float!
    avgLifeExpectancyYear: Int!
    countries: Int!
    "Latest year present anywhere in the dataset."
    latestYear: Int!
  }

  "Unweighted mean of an indicator across the countries in a region."
  type RegionAverage {
    region: String!
    regionCode: String!
    average: Float!
    "Number of countries in the region that had a value for the year."
    countryCount: Int!
  }

  type SnapshotValue {
    indicatorCode: String!
    value: Float!
  }

  "Several indicator values for one country in one year."
  type CountrySnapshot {
    country: Country!
    "Only indicators that have a value for the year are present."
    values: [SnapshotValue!]!
  }

  enum SortOrder {
    ASC
    DESC
  }

  "A named dashboard configuration that can be saved and reopened. Shared by everyone using the app."
  type SavedView {
    id: Int!
    "Unique display name, at most 60 characters."
    name: String!
    "Code of the indicator the dashboard shows. The indicator may since have been removed from the database."
    indicatorCode: String!
    "Year shown on the dashboard. Null means the indicator's latest year at the time the view is opened."
    year: Int
    "ISO 3166-1 alpha-3 codes of the countries on the line chart, in the order they were saved."
    countries: [String!]!
    "Order of the ranking table."
    order: SortOrder!
    "World Bank region highlighted on the scatter chart, if any."
    region: String
    createdAt: String!
  }

  "The dashboard configuration to store as a saved view."
  input SaveViewInput {
    "Display name. Surrounding whitespace is trimmed; must be 1-60 characters and not already in use."
    name: String!
    "Code of an indicator that exists in the database, e.g. NY.GDP.PCAP.CD"
    indicatorCode: String!
    "Year to show. Omit or pass null to follow the indicator's latest year."
    year: Int
    "Between 1 and 8 ISO 3166-1 alpha-3 country codes for the line chart."
    countries: [String!]!
    "Order of the ranking table."
    order: SortOrder! = DESC
    "World Bank region to highlight on the scatter chart. Omit or pass null for none."
    region: String
  }

  type Query {
    "Simple health-check style query that does not touch the database."
    hello: String!

    "All greetings stored in the SQLite database, newest first."
    greetings: [Greeting!]!

    "Counts and freshness of the World Bank data."
    dataSummary: DataSummary!

    "Countries, optionally filtered by region and/or income level."
    countries(region: String, incomeLevel: String): [Country!]!

    "A single country by ISO3 code."
    country(code: String!): Country

    "All ingested indicators."
    indicators: [Indicator!]!

    "A single indicator by code."
    indicator(code: String!): Indicator

    """
    Observations for an indicator. Filter by country codes and/or year range.
    Results are ordered by year then country code.
    """
    observations(
      indicatorCode: String!
      countryCodes: [String!]
      fromYear: Int
      toYear: Int
    ): [Observation!]!

    """
    Top (or bottom) countries for an indicator in a given year.
    """
    ranking(indicatorCode: String!, year: Int!, limit: Int = 10, order: SortOrder = DESC): [Observation!]!

    "Headline figures for the dashboard."
    dashboardSummary: DashboardSummary!

    "Unweighted mean of an indicator per World Bank region for a year, sorted by average descending."
    regionAverages(indicatorCode: String!, year: Int!): [RegionAverage!]!

    """
    For every country, the values of the requested indicators in a year.
    Countries with no value for any of the indicators are omitted.
    """
    countrySnapshot(indicatorCodes: [String!]!, year: Int!): [CountrySnapshot!]!
  }

  type Mutation {
    "Store a new greeting in the database and return it."
    addGreeting(message: String!): Greeting!

    """
    Save a dashboard configuration under a name and return it.
    Fails with a BAD_USER_INPUT error if the name is empty, too long or already taken,
    or if the configuration itself is invalid.
    """
    saveView(input: SaveViewInput!): SavedView!
  }
`;

const MAX_VIEW_NAME_LENGTH = 60;
/** Mirrors MAX_COUNTRIES in the web app's dashboard params. */
const MAX_VIEW_COUNTRIES = 8;

type SaveViewInput = {
  name: string;
  indicatorCode: string;
  year?: number | null;
  countries: string[];
  order: "ASC" | "DESC";
  region?: string | null;
};

/** An error whose message is safe and useful to show to the user (Yoga masks plain Errors). */
function userError(message: string, field?: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT", ...(field ? { field } : {}) } });
}

type YearArgs = { fromYear?: number | null; toYear?: number | null };

function yearFilter({ fromYear, toYear }: YearArgs): Prisma.IntFilter | undefined {
  if (fromYear == null && toYear == null) return undefined;
  return {
    ...(fromYear != null ? { gte: fromYear } : {}),
    ...(toYear != null ? { lte: toYear } : {}),
  };
}

/** Latest year in which an indicator has values for at least `minCountries` countries. */
async function latestYearWithCoverage(indicatorCode: string, minCountries = 100): Promise<number | null> {
  const rows = await prisma.observation.groupBy({
    by: ["year"],
    where: { indicatorCode },
    _count: { _all: true },
    orderBy: { year: "desc" },
  });
  return rows.find((r) => r._count._all >= minCountries)?.year ?? null;
}

const POPULATION = "SP.POP.TOTL";
const LIFE_EXPECTANCY = "SP.DYN.LE00.IN";

export const resolvers = {
  Query: {
    hello: () => "Hello, World!",

    greetings: async () => prisma.greeting.findMany({ orderBy: { createdAt: "desc" } }),

    dataSummary: async () => {
      const [countries, indicators, observations, regionRows, incomeRows, latest] = await Promise.all([
        prisma.country.count(),
        prisma.indicator.count(),
        prisma.observation.count(),
        prisma.country.findMany({ distinct: ["region"], select: { region: true }, orderBy: { region: "asc" } }),
        prisma.country.findMany({
          distinct: ["incomeLevel"],
          select: { incomeLevel: true },
          orderBy: { incomeLevel: "asc" },
        }),
        prisma.indicator.findFirst({
          where: { lastFetchedAt: { not: null } },
          orderBy: { lastFetchedAt: "desc" },
          select: { lastFetchedAt: true },
        }),
      ]);
      return {
        countries,
        indicators,
        observations,
        regions: regionRows.map((r) => r.region),
        incomeLevels: incomeRows.map((r) => r.incomeLevel),
        lastIngestedAt: latest?.lastFetchedAt?.toISOString() ?? null,
      };
    },

    countries: async (_p: unknown, args: { region?: string | null; incomeLevel?: string | null }) =>
      prisma.country.findMany({
        where: {
          ...(args.region ? { region: args.region } : {}),
          ...(args.incomeLevel ? { incomeLevel: args.incomeLevel } : {}),
        },
        orderBy: { name: "asc" },
      }),

    country: async (_p: unknown, args: { code: string }) =>
      prisma.country.findUnique({ where: { code: args.code.toUpperCase() } }),

    indicators: async () => prisma.indicator.findMany({ orderBy: { name: "asc" } }),

    indicator: async (_p: unknown, args: { code: string }) =>
      prisma.indicator.findUnique({ where: { code: args.code } }),

    observations: async (
      _p: unknown,
      args: { indicatorCode: string; countryCodes?: string[] | null } & YearArgs,
    ) =>
      prisma.observation.findMany({
        where: {
          indicatorCode: args.indicatorCode,
          ...(args.countryCodes?.length ? { countryCode: { in: args.countryCodes.map((c) => c.toUpperCase()) } } : {}),
          ...(yearFilter(args) ? { year: yearFilter(args) } : {}),
        },
        orderBy: [{ year: "asc" }, { countryCode: "asc" }],
      }),

    ranking: async (
      _p: unknown,
      args: { indicatorCode: string; year: number; limit?: number | null; order?: "ASC" | "DESC" | null },
    ) => {
      const limit = Math.min(Math.max(args.limit ?? 10, 1), 250);
      return prisma.observation.findMany({
        where: { indicatorCode: args.indicatorCode, year: args.year },
        orderBy: { value: args.order === "ASC" ? "asc" : "desc" },
        take: limit,
      });
    },

    dashboardSummary: async () => {
      const [popYear, leYear, countries, latest] = await Promise.all([
        latestYearWithCoverage(POPULATION),
        latestYearWithCoverage(LIFE_EXPECTANCY),
        prisma.country.count(),
        prisma.observation.aggregate({ _max: { year: true } }),
      ]);
      const [pop, le] = await Promise.all([
        popYear == null
          ? null
          : prisma.observation.aggregate({ where: { indicatorCode: POPULATION, year: popYear }, _sum: { value: true } }),
        leYear == null
          ? null
          : prisma.observation.aggregate({ where: { indicatorCode: LIFE_EXPECTANCY, year: leYear }, _avg: { value: true } }),
      ]);
      return {
        worldPopulation: pop?._sum.value ?? 0,
        worldPopulationYear: popYear ?? 0,
        avgLifeExpectancy: le?._avg.value ?? 0,
        avgLifeExpectancyYear: leYear ?? 0,
        countries,
        latestYear: latest._max.year ?? 0,
      };
    },

    regionAverages: async (_p: unknown, args: { indicatorCode: string; year: number }) => {
      const rows = await prisma.observation.findMany({
        where: { indicatorCode: args.indicatorCode, year: args.year },
        select: { value: true, country: { select: { region: true, regionCode: true } } },
      });
      const buckets = new Map<string, { region: string; regionCode: string; sum: number; count: number }>();
      for (const row of rows) {
        const b = buckets.get(row.country.regionCode) ?? {
          region: row.country.region,
          regionCode: row.country.regionCode,
          sum: 0,
          count: 0,
        };
        b.sum += row.value;
        b.count += 1;
        buckets.set(row.country.regionCode, b);
      }
      return [...buckets.values()]
        .map((b) => ({ region: b.region, regionCode: b.regionCode, average: b.sum / b.count, countryCount: b.count }))
        .sort((a, b) => b.average - a.average);
    },

    countrySnapshot: async (_p: unknown, args: { indicatorCodes: string[]; year: number }) => {
      const rows = await prisma.observation.findMany({
        where: { indicatorCode: { in: args.indicatorCodes }, year: args.year },
        include: { country: true },
        orderBy: { countryCode: "asc" },
      });
      const byCountry = new Map<string, { country: (typeof rows)[number]["country"]; values: { indicatorCode: string; value: number }[] }>();
      for (const row of rows) {
        const entry = byCountry.get(row.countryCode) ?? { country: row.country, values: [] };
        entry.values.push({ indicatorCode: row.indicatorCode, value: row.value });
        byCountry.set(row.countryCode, entry);
      }
      return [...byCountry.values()];
    },
  },

  Mutation: {
    addGreeting: async (_parent: unknown, args: { message: string }) => {
      const message = args.message.trim();
      if (!message) {
        throw new Error("Greeting message cannot be empty.");
      }
      return prisma.greeting.create({ data: { message } });
    },

    saveView: async (_parent: unknown, args: { input: SaveViewInput }) => {
      const { input } = args;

      const name = input.name.trim();
      if (!name) throw userError("Give the view a name.", "name");
      // Count code points so an emoji counts as one character, as a user would expect.
      if ([...name].length > MAX_VIEW_NAME_LENGTH) {
        throw userError(`View names can be at most ${MAX_VIEW_NAME_LENGTH} characters.`, "name");
      }

      const indicatorCode = input.indicatorCode.trim();
      if (!indicatorCode) throw userError("A view needs an indicator.", "indicatorCode");

      if (input.year != null && input.year <= 0) {
        throw userError("Year must be a positive number.", "year");
      }

      const countries = [...new Set(input.countries.map((c) => c.trim().toUpperCase()))];
      if (countries.length === 0) throw userError("A view needs at least one country.", "countries");
      if (countries.length > MAX_VIEW_COUNTRIES) {
        throw userError(`A view can have at most ${MAX_VIEW_COUNTRIES} countries.`, "countries");
      }
      const badCode = countries.find((c) => !/^[A-Z]{3}$/.test(c));
      if (badCode !== undefined) {
        throw userError(`"${badCode}" is not a three-letter country code.`, "countries");
      }

      const region = input.region?.trim() || null;

      const [indicator, nameTaken] = await Promise.all([
        prisma.indicator.findUnique({ where: { code: indicatorCode }, select: { code: true } }),
        prisma.savedView.findUnique({ where: { name }, select: { id: true } }),
      ]);
      if (!indicator) throw userError(`There is no indicator with code "${indicatorCode}".`, "indicatorCode");
      const duplicate = userError(`A view called "${name}" already exists. Choose a different name.`, "name");
      if (nameTaken) throw duplicate;

      try {
        return await prisma.savedView.create({
          data: { name, indicatorCode, year: input.year ?? null, countries: countries.join(","), order: input.order, region },
        });
      } catch (err) {
        // Two saves with the same name can race past the check above; the unique index catches it.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw duplicate;
        throw err;
      }
    },
  },

  SavedView: {
    countries: (parent: { countries: string }) => parent.countries.split(",").filter(Boolean),
    createdAt: (parent: { createdAt: Date }) => parent.createdAt.toISOString(),
  },

  Greeting: {
    createdAt: (parent: { createdAt: Date }) => parent.createdAt.toISOString(),
  },

  Country: {
    observations: async (parent: { code: string }, args: { indicatorCode?: string | null } & YearArgs) =>
      prisma.observation.findMany({
        where: {
          countryCode: parent.code,
          ...(args.indicatorCode ? { indicatorCode: args.indicatorCode } : {}),
          ...(yearFilter(args) ? { year: yearFilter(args) } : {}),
        },
        orderBy: [{ indicatorCode: "asc" }, { year: "asc" }],
      }),
  },

  Indicator: {
    lastFetchedAt: (parent: { lastFetchedAt: Date | null }) => parent.lastFetchedAt?.toISOString() ?? null,
    observationCount: (parent: { code: string }) =>
      prisma.observation.count({ where: { indicatorCode: parent.code } }),
    latestYear: (parent: { code: string }) => latestYearWithCoverage(parent.code),
    yearRange: async (parent: { code: string }) => {
      const agg = await prisma.observation.aggregate({
        where: { indicatorCode: parent.code },
        _min: { year: true },
        _max: { year: true },
      });
      if (agg._min.year == null || agg._max.year == null) return null;
      return { min: agg._min.year, max: agg._max.year };
    },
  },

  Observation: {
    country: (parent: { countryCode: string }) =>
      prisma.country.findUniqueOrThrow({ where: { code: parent.countryCode } }),
    indicator: (parent: { indicatorCode: string }) =>
      prisma.indicator.findUniqueOrThrow({ where: { code: parent.indicatorCode } }),
  },
};

export const schema = createSchema({ typeDefs, resolvers });
