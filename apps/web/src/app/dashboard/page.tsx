import { Suspense } from "react";
import {
  GDP_PER_CAPITA,
  LIFE_EXPECTANCY,
  fetchDashboardData,
  fetchDashboardMeta,
  parseParams,
  parseViewId,
  toScatterPoints,
  type RawSearchParams,
} from "@/lib/dashboard";
import { formatCompact, formatIndicatorValue, shortIndicatorName } from "@/lib/format";
import { getGraphqlUrl } from "@/lib/graphql";
import { viewToParams } from "@/lib/saved-views";
import { StatTile } from "@/components/StatTile";
import { ChartCard, EmptyChart } from "@/components/charts/ChartCard";
import { DataTable } from "@/components/charts/DataTable";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { RegionBarChart } from "@/components/charts/RegionBarChart";
import { GdpLifeScatter } from "@/components/charts/GdpLifeScatter";
import { RankingTable } from "@/components/dashboard/RankingTable";
import { Controls } from "@/components/dashboard/Controls";

export const dynamic = "force-dynamic";

export const metadata = { title: "Dashboard · Code Reviews" };

type PageProps = { searchParams: Promise<RawSearchParams> };

export default async function DashboardPage({ searchParams }: PageProps) {
  const rawParams = await searchParams;
  let params = parseParams(rawParams);
  const viewId = parseViewId(rawParams);

  let meta;
  try {
    meta = await fetchDashboardMeta();
  } catch (err) {
    return (
      <main className="mx-auto w-full max-w-6xl px-6 py-16">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p className="font-medium">Could not reach the GraphQL API at {getGraphqlUrl()}.</p>
          <p className="mt-1 font-mono text-xs">{err instanceof Error ? err.message : String(err)}</p>
        </div>
      </main>
    );
  }

  // `?view=<id>` opens a saved view: its stored configuration replaces the other parameters.
  // A view that is gone, or whose indicator is gone, falls back to the default dashboard with a notice.
  let activeView = viewId == null ? null : (meta.savedViews.find((v) => v.id === viewId) ?? null);
  let viewNotice: string | null = null;
  if (viewId != null && !activeView) {
    viewNotice = "That saved view no longer exists. Showing the default dashboard instead.";
    params = parseParams({});
  } else if (activeView && !meta.indicators.some((i) => i.code === activeView?.indicatorCode)) {
    viewNotice = `The saved view “${activeView.name}” can’t be shown because its indicator (${activeView.indicatorCode}) is no longer in the database. Showing the default dashboard instead.`;
    activeView = null;
    params = parseParams({});
  } else if (activeView) {
    params = viewToParams(activeView);
  }

  const indicator =
    meta.indicators.find((i) => i.code === params.indicator) ?? meta.indicators[0];
  const yearRange = indicator.yearRange ?? { min: 1960, max: meta.dashboardSummary.latestYear };
  const year = params.year ?? indicator.latestYear ?? yearRange.max;
  const yearOptions = Array.from({ length: yearRange.max - yearRange.min + 1 }, (_, i) => yearRange.max - i);

  // The scatter needs both GDP per capita and life expectancy, which end in
  // different years, so it uses the latest year in which both are available.
  const latestFor = (code: string) => meta.indicators.find((i) => i.code === code)?.latestYear ?? year;
  const scatterYear = Math.min(year, latestFor(GDP_PER_CAPITA), latestFor(LIFE_EXPECTANCY));

  const data = await fetchDashboardData({
    indicator: indicator.code,
    year,
    countries: params.countries,
    order: params.order,
    snapshotYear: scatterYear,
  });

  const indicatorName = shortIndicatorName(indicator.code, indicator.name);
  const selectedCountries = params.countries.map((code) => ({
    code,
    name: meta.countries.find((c) => c.code === code)?.name ?? code,
  }));
  const scatterPoints = toScatterPoints(data.countrySnapshot);
  const { dashboardSummary: summary } = meta;

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Code Reviews</p>
        <h1 className="text-3xl font-semibold tracking-tight">World Bank dashboard</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {summary.countries} countries · data up to {summary.latestYear}
        </p>
      </header>

      {/* 1. Headline tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="World population"
          value={formatCompact(summary.worldPopulation)}
          caption={`Sum of country figures, ${summary.worldPopulationYear}`}
        />
        <StatTile
          label="Avg life expectancy"
          value={formatIndicatorValue(LIFE_EXPECTANCY, summary.avgLifeExpectancy)}
          caption={`Unweighted mean, ${summary.avgLifeExpectancyYear}`}
        />
        <StatTile label="Countries" value={String(summary.countries)} caption="Aggregates excluded" />
        <StatTile label="Latest data" value={String(summary.latestYear)} caption="Across all indicators" />
      </div>

      {viewNotice && (
        <p
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          {viewNotice}
        </p>
      )}

      <Suspense>
        <Controls
          savedViews={meta.savedViews}
          activeView={activeView}
          indicators={meta.indicators}
          countries={meta.countries}
          regions={meta.dataSummary.regions}
          selected={{
            indicator: indicator.code,
            year,
            countries: params.countries,
            order: params.order,
            region: params.region,
          }}
          yearOptions={yearOptions}
        />
      </Suspense>

      {/* 2. Indicator over time */}
      <ChartCard
        title={`${indicatorName} over time`}
        subtitle={`${selectedCountries.map((c) => c.name).join(", ")} · ${yearRange.min}–${yearRange.max}`}
        table={
          <DataTable
            columns={["Year", ...selectedCountries.map((c) => c.name)]}
            rows={pivotForTable(data.observations, params.countries, indicator.code)}
          />
        }
      >
        {data.observations.length === 0 ? (
          <EmptyChart message="No observations for the selected countries." />
        ) : (
          <TimeSeriesChart indicatorCode={indicator.code} countries={selectedCountries} observations={data.observations} />
        )}
      </ChartCard>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 3. Ranking */}
        <ChartCard
          title={`${params.order === "DESC" ? "Top" : "Bottom"} 10 · ${indicatorName}`}
          subtitle={`${year}`}
        >
          <RankingTable indicatorCode={indicator.code} rows={data.ranking} />
        </ChartCard>

        {/* 4. Regional comparison */}
        <ChartCard
          title={`${indicatorName} by region`}
          subtitle={`Unweighted mean across countries, ${year}`}
          table={
            <DataTable
              columns={["Region", "Average", "Countries"]}
              rows={data.regionAverages.map((r) => [
                r.region,
                formatIndicatorValue(indicator.code, r.average),
                r.countryCount,
              ])}
            />
          }
        >
          {data.regionAverages.length === 0 ? (
            <EmptyChart message={`No data for ${year}.`} />
          ) : (
            <RegionBarChart indicatorCode={indicator.code} data={data.regionAverages} />
          )}
        </ChartCard>
      </div>

      {/* 5. GDP vs life expectancy */}
      <ChartCard
        title="GDP per capita vs life expectancy"
        subtitle={`One dot per country, ${scatterYear}${scatterYear !== year ? " (latest year with both indicators)" : ""}${params.region ? ` · highlighting ${params.region}` : ""} · ${scatterPoints.length} countries with both values`}
        table={
          <DataTable
            columns={["Country", "Region", "GDP per capita", "Life expectancy"]}
            rows={scatterPoints.map((p) => [
              p.name,
              p.region,
              formatIndicatorValue(GDP_PER_CAPITA, p.gdp),
              formatIndicatorValue(LIFE_EXPECTANCY, p.life),
            ])}
          />
        }
      >
        {scatterPoints.length === 0 ? (
          <EmptyChart message={`No countries have both GDP per capita and life expectancy for ${scatterYear}.`} />
        ) : (
          <GdpLifeScatter points={scatterPoints} highlightRegion={params.region} />
        )}
      </ChartCard>
    </main>
  );
}

/** Rows for the time-series table view: one per year, one column per country. */
function pivotForTable(
  observations: { countryCode: string; year: number; value: number }[],
  countries: string[],
  indicatorCode: string,
): (string | number)[][] {
  const byYear = new Map<number, Record<string, number>>();
  for (const o of observations) {
    const row = byYear.get(o.year) ?? {};
    row[o.countryCode] = o.value;
    byYear.set(o.year, row);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, row]) => [
      year,
      ...countries.map((c) => (row[c] != null ? formatIndicatorValue(indicatorCode, row[c]) : "—")),
    ]);
}
