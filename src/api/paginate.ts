
import type { D2LApiClient } from "./client.js";
import { log } from "../utils/logger.js";


const MAX_PAGES = 200;

interface PagedItems<T> {
  Items?: T[] | null;
  PagingInfo?: { HasMoreItems?: boolean; Bookmark?: string | null } | null;
}

interface PagedObjects<T> {
  Objects?: T[] | null;
  Next?: string | null;
}

export interface PaginateOptions {
  ttl?: number;
}

function withBookmark(firstPath: string, bookmark: string): string {
  const separator = firstPath.includes("?") ? "&" : "?";
  return `${firstPath}${separator}bookmark=${encodeURIComponent(bookmark)}`;
}

export async function fetchAllItems<T>(
  apiClient: D2LApiClient,
  firstPath: string,
  options?: PaginateOptions
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let path: string | null = firstPath;
  let pages = 0;

  while (path !== null) {
    if (pages >= MAX_PAGES) {
      log("WARN", `Pagination stopped at the ${MAX_PAGES} page ceiling`, { firstPath });
      break;
    }

    const response: PagedItems<T> = await apiClient.get<PagedItems<T>>(path, options);
    pages += 1;
    items.push(...(response?.Items ?? []));

    const paging = response?.PagingInfo;
    const bookmark = paging?.Bookmark;
    if (!paging?.HasMoreItems || !bookmark) break;
    if (seen.has(bookmark)) {
      log("WARN", "Pagination stopped: the server repeated a bookmark", { firstPath });
      break;
    }

    seen.add(bookmark);
    path = withBookmark(firstPath, bookmark);
  }

  return items;
}

export async function fetchAllObjects<T>(
  apiClient: D2LApiClient,
  firstPath: string,
  options?: PaginateOptions
): Promise<T[]> {
  const objects: T[] = [];
  const seen = new Set<string>();
  let path: string | null = firstPath;
  let pages = 0;

  while (path !== null) {
    if (pages >= MAX_PAGES) {
      log("WARN", `Pagination stopped at the ${MAX_PAGES} page ceiling`, { firstPath });
      break;
    }

    const response: PagedObjects<T> = await apiClient.get<PagedObjects<T>>(path, options);
    pages += 1;
    objects.push(...(response?.Objects ?? []));

    const next = response?.Next;
    if (!next) break;
    if (seen.has(next)) {
      log("WARN", "Pagination stopped: the server repeated a next page", { firstPath });
      break;
    }

    seen.add(next);
    path = nextPath(firstPath, next);
  }

  return objects;
}

function nextPath(firstPath: string, next: string): string {
  if (/^https?:\/\//i.test(next)) {
    const url = new URL(next);
    return `${url.pathname}${url.search}`;
  }
  // A Next that begins with a slash is already a path, not a bookmark.
  // Appending it as one would ask for a page that does not exist.
  if (next.startsWith("/")) {
    return next;
  }
  return withBookmark(firstPath, next);
}
