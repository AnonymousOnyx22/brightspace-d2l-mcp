
import type { CourseFilterConfig } from "../types/index.js";
import { log } from "./logger.js";

interface FilterableCourse {
  id: number;
  isActive: boolean;
  canAccess?: boolean;
}

export function applyCourseFilter<T extends FilterableCourse>(
  courses: T[],
  config: CourseFilterConfig
): T[] {
  let filtered = courses;
  const originalCount = courses.length;

  if (config.activeOnly) {
    filtered = filtered.filter(c => c.isActive);
    filtered = filtered.filter(c => c.canAccess !== false);
  }

  if (config.includeCourseIds && config.includeCourseIds.length > 0) {
    filtered = filtered.filter(c => config.includeCourseIds!.includes(c.id));
  }

  if (config.excludeCourseIds && config.excludeCourseIds.length > 0) {
    filtered = filtered.filter(c => !config.excludeCourseIds!.includes(c.id));
  }

  if (filtered.length !== originalCount) {
    log("DEBUG", `Course filter: ${originalCount} -> ${filtered.length} courses`, {
      activeOnly: config.activeOnly,
      include: config.includeCourseIds,
      exclude: config.excludeCourseIds,
    });
  }

  return filtered;
}
