// Course tools take a numeric course id, but people name a course by its title
// or code. This helper turns either kind of reference into the matching course
// from an enrollment list, so callers do not have to invent their own matching
// rules.

export interface CourseIdentity {
  id: number;
  name?: string | null;
  code?: string | null;
}

export type CourseRefMatchKind = "id" | "code" | "name" | "codePartial" | "namePartial";

export interface CourseRefMatch<T extends CourseIdentity = CourseIdentity> {
  course: T;
  matchedBy: CourseRefMatchKind;
}

// The reference did not match any course in the list. The message names the
// tool that lists the valid names, codes and ids.
export class CourseRefNotFoundError extends Error {
  constructor(public readonly ref: string) {
    super(`No course matches "${ref}". Call \`get_my_courses\` to list your course names, codes and IDs, then try again.`);
    this.name = "CourseRefNotFoundError";
  }
}

// The reference matched more than one course. The caller has to choose, so the
// message shows every candidate instead of guessing.
export class CourseRefAmbiguousError extends Error {
  constructor(public readonly ref: string, public readonly candidates: CourseIdentity[]) {
    const list = candidates
      .map((course) => `${course.name ?? "(no name)"} (${course.code ?? "no code"}, id ${course.id})`)
      .join("; ");
    super(`"${ref}" matches more than one course: ${list}. Pass the course ID instead.`);
    this.name = "CourseRefAmbiguousError";
  }
}

// Case, surrounding space and repeated inner space should not decide a match.
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

// Course codes are written both with and without a space ("CS 101" and
// "CS101"), so compare a compact form as well.
function compact(value: string): string {
  return normalize(value).replace(/\s+/g, "");
}

function labels(course: CourseIdentity): { name: string; code: string } {
  return {
    name: course.name ? normalize(course.name) : "",
    code: course.code ? normalize(course.code) : "",
  };
}

function uniqueById<T extends CourseIdentity>(courses: T[]): T[] {
  const seen = new Set<number>();
  return courses.filter((course) => {
    if (seen.has(course.id)) return false;
    seen.add(course.id);
    return true;
  });
}

// Every course that matches at the strongest level the reference reaches.
// Exact matches win over partial matches, and a code match wins over a name
// match, so "CS 101" picks the course whose code is CS 101 even when another
// course title happens to contain the same text.
function bestMatches<T extends CourseIdentity>(ref: string, courses: T[]): CourseRefMatch<T>[] {
  const wanted = normalize(ref);
  const wantedCompact = compact(ref);

  const levels: Array<{ kind: CourseRefMatchKind; test: (course: T) => boolean }> = [
    { kind: "code", test: (course) => labels(course).code === wanted || compact(labels(course).code) === wantedCompact },
    { kind: "name", test: (course) => labels(course).name === wanted || compact(labels(course).name) === wantedCompact },
    {
      kind: "codePartial",
      test: (course) => {
        const code = labels(course).code;
        return code.length > 0 && (code.includes(wanted) || compact(code).includes(wantedCompact));
      },
    },
    {
      kind: "namePartial",
      test: (course) => {
        const name = labels(course).name;
        return name.length > 0 && (name.includes(wanted) || compact(name).includes(wantedCompact));
      },
    },
  ];

  for (const level of levels) {
    const matches = uniqueById(courses.filter(level.test));
    if (matches.length > 0) {
      return matches.map((course) => ({ course, matchedBy: level.kind }));
    }
  }

  return [];
}

// Returns every course that matches the reference, strongest matches first.
// Useful when a caller wants to show choices instead of failing on ambiguity.
export function findCourseRefs<T extends CourseIdentity>(ref: string | number, courses: readonly T[]): CourseRefMatch<T>[] {
  const list = [...courses];

  if (typeof ref === "number" || /^\d+$/.test(ref.trim())) {
    const id = typeof ref === "number" ? ref : Number(ref.trim());
    const course = list.find((candidate) => candidate.id === id);
    return course ? [{ course, matchedBy: "id" }] : [];
  }

  const text = ref.trim();
  if (!text) return [];
  return bestMatches(text, list);
}

// Resolves a course name, code or id to one course. Throws when the reference
// is empty, matches nothing or matches more than one course, so a caller never
// silently acts on the wrong course.
export function resolveCourseRef<T extends CourseIdentity>(ref: string | number, courses: readonly T[]): T {
  const matches = findCourseRefs(ref, courses);
  if (matches.length === 0) throw new CourseRefNotFoundError(String(ref).trim());
  if (matches.length > 1) {
    throw new CourseRefAmbiguousError(
      String(ref).trim(),
      matches.map((match) => match.course)
    );
  }
  return matches[0].course;
}
