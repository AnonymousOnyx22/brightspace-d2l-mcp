export interface TokenData {
  accessToken: string;
  tenantOrigin?: string;
  capturedAt: number; // Unix timestamp ms
  expiresAt: number; // Unix timestamp ms
  source: "browser" | "cache";
  cookieHeader?: string;
  csrfToken?: string;
}

export interface AppConfig {
  baseUrl: string;
  tokenTtl: number; // seconds
  autoLogin: boolean;
  courseFilter: CourseFilterConfig;
}

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface CourseFilterConfig {
  includeCourseIds?: number[];
  excludeCourseIds?: number[];
  activeOnly: boolean;
}
