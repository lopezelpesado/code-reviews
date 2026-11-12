import { gqlFetch } from "@/lib/graphql";
import type { SortOrder } from "@/lib/dashboard";

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

const SAVE_VIEW_MUTATION = /* GraphQL */ `
  mutation SaveView($input: SaveViewInput!) {
    saveView(input: $input) {
      id
      name
      indicatorCode
      year
      countries
      order
      region
      createdAt
    }
  }
`;

/**
 * Save a dashboard configuration. Rejects with an Error whose message is fit to
 * show to the user (the API's validation message, or a connectivity message).
 */
export async function saveView(input: SaveViewInput): Promise<SavedView> {
  try {
    const data = await gqlFetch<{ saveView: SavedView }>(SAVE_VIEW_MUTATION, { input });
    return data.saveView;
  } catch (err) {
    // fetch() rejects with a TypeError when the request never reached the API.
    if (err instanceof TypeError) {
      throw new Error("Could not reach the server, so the view was not saved. Please try again.");
    }
    throw err;
  }
}
