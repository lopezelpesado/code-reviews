"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import { MAX_COUNTRIES, type CountryMeta, type IndicatorMeta, type SortOrder } from "@/lib/dashboard";
import { shortIndicatorName } from "@/lib/format";
import { MAX_VIEW_NAME_LENGTH, saveView, savedViewHref, viewToQuery, type SavedView } from "@/lib/saved-views";

type Props = {
  indicators: IndicatorMeta[];
  countries: CountryMeta[];
  regions: string[];
  selected: {
    indicator: string;
    year: number;
    countries: string[];
    order: SortOrder;
    region: string | null;
  };
  yearOptions: number[];
  /** Every saved view, newest first. */
  savedViews: SavedView[];
  /** The saved view the dashboard is currently showing, if it was opened from one. */
  activeView: SavedView | null;
};

const chipClass = "inline-flex max-w-56 items-center rounded-full border px-2.5 py-0.5 text-xs";

const selectClass =
  "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

const buttonClass =
  "rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClass = `${buttonClass} border-zinc-900 bg-zinc-900 text-white enabled:hover:bg-zinc-700 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:enabled:hover:bg-zinc-300`;
const secondaryButtonClass = `${buttonClass} border-zinc-300 enabled:hover:bg-zinc-100 dark:border-zinc-700 dark:enabled:hover:bg-zinc-800`;

/** The query string keys that make up a dashboard configuration. */
const CONFIG_KEYS = ["indicator", "year", "countries", "order", "region"];

type SaveState =
  | { step: "closed"; savedName?: string }
  | { step: "naming"; error?: string }
  | { step: "saving" };

/**
 * Every control writes to the URL query string; the server component re-renders
 * with the new parameters. The dashboard configuration is never held in component
 * state; only the transient "save view" form is.
 */
export function Controls({
  indicators,
  countries,
  regions,
  selected,
  yearOptions,
  savedViews,
  activeView,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const update = useCallback(
    (changes: Record<string, string | null>) => {
      // Changing a control while a saved view is open starts from that view's
      // configuration and leaves the view: the dashboard no longer matches it.
      const next = activeView ? viewToQuery(activeView) : new URLSearchParams(searchParams.toString());
      next.delete("view");
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams, activeView],
  );

  const [save, setSave] = useState<SaveState>({ step: "closed" });
  const [viewName, setViewName] = useState("");

  // With no configuration in the URL the dashboard is showing its defaults, or a
  // saved view as it was saved: either way there is nothing new to save yet.
  const hasSelection = !activeView && CONFIG_KEYS.some((k) => searchParams.has(k));

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    const name = viewName.trim();
    if (!name) return setSave({ step: "naming", error: "Give the view a name." });
    if ([...name].length > MAX_VIEW_NAME_LENGTH) {
      return setSave({ step: "naming", error: `View names can be at most ${MAX_VIEW_NAME_LENGTH} characters.` });
    }
    setSave({ step: "saving" });
    try {
      const saved = await saveView({
        name,
        indicatorCode: selected.indicator,
        // A view mirrors the URL: without an explicit year it keeps following the latest one.
        year: searchParams.has("year") ? selected.year : null,
        countries: selected.countries,
        order: selected.order,
        region: selected.region,
      });
      setViewName("");
      setSave({ step: "closed", savedName: saved.name });
      // Open the new view: the list picks it up and the dashboard now shows it as the current view.
      router.replace(savedViewHref(saved), { scroll: false });
    } catch (err) {
      setSave({ step: "naming", error: err instanceof Error ? err.message : "The view could not be saved." });
    }
  };

  const countryName = (code: string) => countries.find((c) => c.code === code)?.name ?? code;
  const addable = countries.filter((c) => !selected.countries.includes(c.code));

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <nav aria-label="Saved views" className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500">Saved views</span>
        {savedViews.length === 0 && <span className="text-xs text-zinc-400">None yet</span>}
        {savedViews.map((view) => {
          const isActive = view.id === activeView?.id;
          return (
            <Link
              key={view.id}
              href={savedViewHref(view)}
              scroll={false}
              title={view.name}
              aria-current={isActive ? "page" : undefined}
              className={`${chipClass} ${
                isActive
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              }`}
            >
              <span className="truncate">{view.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Indicator
          <select
            className={selectClass}
            value={selected.indicator}
            // Changing indicator clears the year so the indicator's latest year is used.
            onChange={(e) => update({ indicator: e.target.value, year: null })}
          >
            {indicators.map((i) => (
              <option key={i.code} value={i.code}>
                {shortIndicatorName(i.code, i.name)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Year
          <select className={selectClass} value={selected.year} onChange={(e) => update({ year: e.target.value })}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Ranking
          <select className={selectClass} value={selected.order} onChange={(e) => update({ order: e.target.value })}>
            <option value="DESC">Highest first</option>
            <option value="ASC">Lowest first</option>
          </select>
        </label>

        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs text-zinc-500">
          Highlight region
          <select
            className={`${selectClass} max-w-full`}
            value={selected.region ?? ""}
            onChange={(e) => update({ region: e.target.value || null })}
          >
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        {save.step === "closed" && (
          <button
            type="button"
            className={`${secondaryButtonClass} ml-auto`}
            disabled={!hasSelection}
            title={
              hasSelection
                ? undefined
                : activeView
                  ? `Already saved as “${activeView.name}”. Change a control to save a new view.`
                  : "Change the dashboard from its defaults to save it as a view"
            }
            onClick={() => setSave({ step: "naming" })}
          >
            Save view
          </button>
        )}
      </div>

      {save.step !== "closed" && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={onSave}
          onKeyDown={(e) => e.key === "Escape" && save.step === "naming" && setSave({ step: "closed" })}
        >
          <label className="flex min-w-0 flex-1 basis-64 flex-col gap-1 text-xs text-zinc-500">
            View name
            <input
              type="text"
              className={`${selectClass} w-full`}
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder="e.g. G7 life expectancy"
              autoFocus
              autoComplete="off"
              disabled={save.step === "saving"}
              aria-invalid={save.step === "naming" && save.error ? true : undefined}
              aria-describedby={save.step === "naming" && save.error ? "save-view-error" : undefined}
            />
          </label>
          <button type="submit" className={primaryButtonClass} disabled={save.step === "saving"}>
            {save.step === "saving" ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={save.step === "saving"}
            onClick={() => setSave({ step: "closed" })}
          >
            Cancel
          </button>
          {save.step === "naming" && save.error && (
            <p id="save-view-error" role="alert" className="basis-full text-xs text-red-700 dark:text-red-400">
              {save.error}
            </p>
          )}
        </form>
      )}

      {save.step === "closed" && save.savedName && (
        <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">
          Saved view “{save.savedName}”.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500">Countries</span>
        {selected.countries.map((code) => (
          <span
            key={code}
            className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2.5 py-0.5 text-xs dark:border-zinc-700"
          >
            {countryName(code)}
            <button
              type="button"
              aria-label={`Remove ${countryName(code)}`}
              className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              onClick={() => update({ countries: selected.countries.filter((c) => c !== code).join(",") })}
            >
              ×
            </button>
          </span>
        ))}
        {selected.countries.length < MAX_COUNTRIES && (
          <select
            className={`${selectClass} py-0.5 text-xs`}
            value=""
            aria-label="Add country"
            onChange={(e) => e.target.value && update({ countries: [...selected.countries, e.target.value].join(",") })}
          >
            <option value="">+ Add country…</option>
            {addable.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {selected.countries.length >= MAX_COUNTRIES && (
          <span className="text-xs text-zinc-400">Maximum of {MAX_COUNTRIES} countries</span>
        )}
      </div>
    </div>
  );
}
