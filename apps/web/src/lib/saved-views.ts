import { gqlFetch } from "@/lib/graphql";
import type { DashboardParams, SortOrder } from "@/lib/dashboard";

/** Mirrors the limit enforced by the API's saveView mutation. */
export const MAX_VIEW_NAME_LENGTH = 60;

export type SavedView = {
  id: number;
  name: string;
  indicatorCode: string;
  year: number | null; // null = follow the indicator's latest year
  countries: string[];
  order: SortOrder;
  region: string | null;
  createdAt: string;
};

export type SaveViewInput = Omit<SavedView, "id" | "createdAt">;

/** GraphQL selection for a full SavedView, shared by every query and mutation that returns one. */
export const SAVED_VIEW_FIELDS = /* GraphQL */ `
  id
  name
  indicatorCode
  year
  countries
  order
  region
  createdAt
`;

/** Link that opens a saved view on the dashboard. */
export function savedViewHref(view: Pick<SavedView, "id">): string {
  return `/dashboard?view=${view.id}`;
}

/** The dashboard parameters a saved view stands for. */
export function viewToParams(view: SavedView): DashboardParams {
  return {
    indicator: view.indicatorCode,
    year: view.year,
    countries: view.countries,
    order: view.order,
    region: view.region,
  };
}

/** The dashboard query string equivalent to a saved view, used when a control changes while a view is open. */
export function viewToQuery(view: SavedView): URLSearchParams {
  const query = new URLSearchParams({
    indicator: view.indicatorCode,
    countries: view.countries.join(","),
    order: view.order,
  });
  if (view.year != null) query.set("year", String(view.year));
  if (view.region) query.set("region", view.region);
  return query;
}

const SAVE_VIEW_MUTATION = /* GraphQL */ `
  mutation SaveView($input: SaveViewInput!) {
    saveView(input: $input) {
      ${SAVED_VIEW_FIELDS}
    }
  }
`;

const DELETE_VIEW_MUTATION = /* GraphQL */ `
  mutation DeleteView($id: Int!) {
    deleteView(id: $id) {
      id
    }
  }
`;

/**
 * Run a mutation from the browser. Rejects with an Error whose message is fit to
 * show to the user: the API's own message, or `unreachable` if the request never got there.
 */
async function mutate<T>(query: string, variables: Record<string, unknown>, unreachable: string): Promise<T> {
  try {
    return await gqlFetch<T>(query, variables);
  } catch (err) {
    // fetch() rejects with a TypeError when the request never reached the API.
    if (err instanceof TypeError) throw new Error(unreachable);
    throw err;
  }
}

/** Save a dashboard configuration. Rejects with a user-facing message, e.g. the API's validation message. */
export async function saveView(input: SaveViewInput): Promise<SavedView> {
  const data = await mutate<{ saveView: SavedView }>(
    SAVE_VIEW_MUTATION,
    { input },
    "Could not reach the server, so the view was not saved. Please try again.",
  );
  return data.saveView;
}

/** Delete a saved view. Rejects with a user-facing message, e.g. if the view was already deleted. */
export async function deleteView(id: number): Promise<void> {
  await mutate<{ deleteView: { id: number } }>(
    DELETE_VIEW_MUTATION,
    { id },
    "Could not reach the server, so the view was not deleted. Please try again.",
  );
}
