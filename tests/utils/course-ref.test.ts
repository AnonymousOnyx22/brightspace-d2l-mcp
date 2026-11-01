import { describe, expect, it } from "vitest";
import {
  CourseRefAmbiguousError,
  CourseRefNotFoundError,
  findCourseRefs,
  resolveCourseRef,
  type CourseIdentity,
} from "../../src/utils/course-ref.js";

const COURSES: CourseIdentity[] = [
  { id: 101, name: "Calculus I", code: "MATH 101" },
  { id: 102, name: "Calculus II", code: "MATH 102" },
  { id: 201, name: "Intro to Computer Science", code: "CS 101" },
  { id: 202, name: "Data Structures", code: "CS 201" },
];

describe("resolveCourseRef", () => {
  it("accepts a numeric id as a number or a string", () => {
    expect(resolveCourseRef(202, COURSES).id).toBe(202);
    expect(resolveCourseRef("202", COURSES).id).toBe(202);
  });

  it("matches a course code exactly and ignores case and extra spaces", () => {
    expect(resolveCourseRef("cs 101", COURSES).id).toBe(201);
    expect(resolveCourseRef("CS101", COURSES).id).toBe(201);
    expect(resolveCourseRef("  math   102  ", COURSES).id).toBe(102);
  });

  it("matches a course name exactly and ignores case", () => {
    expect(resolveCourseRef("data structures", COURSES).id).toBe(202);
  });

  it("prefers a code match over a name match", () => {
    const courses: CourseIdentity[] = [
      { id: 1, name: "CS 101", code: "OTHER 1" },
      { id: 2, name: "Something Else", code: "CS 101" },
    ];
    expect(resolveCourseRef("CS 101", courses).id).toBe(2);
  });

  it("matches a unique part of a course name", () => {
    expect(resolveCourseRef("Data", COURSES).id).toBe(202);
  });

  it("fails when a partial name matches more than one course", () => {
    expect(() => resolveCourseRef("Calculus", COURSES)).toThrow(CourseRefAmbiguousError);
  });

  it("lists the candidates when a reference is ambiguous", () => {
    try {
      resolveCourseRef("Calculus", COURSES);
      throw new Error("expected an ambiguity error");
    } catch (error) {
      expect(error).toBeInstanceOf(CourseRefAmbiguousError);
      const ambiguous = error as CourseRefAmbiguousError;
      expect(ambiguous.candidates.map((course) => course.id)).toEqual([101, 102]);
      expect(ambiguous.message).toContain("Calculus I");
      expect(ambiguous.message).toContain("Calculus II");
      expect(ambiguous.message).toContain("Pass the course ID");
    }
  });

  it("fails with the next step when nothing matches", () => {
    expect(() => resolveCourseRef("Chemistry", COURSES)).toThrow(CourseRefNotFoundError);
    try {
      resolveCourseRef("Chemistry", COURSES);
    } catch (error) {
      expect((error as Error).message).toContain("get_my_courses");
    }
  });

  it("fails on an empty reference", () => {
    expect(() => resolveCourseRef("   ", COURSES)).toThrow(CourseRefNotFoundError);
  });

  it("does not treat a numeric name or code as an id", () => {
    const courses: CourseIdentity[] = [{ id: 1, name: "202", code: "HIST 1" }];
    expect(() => resolveCourseRef(202, courses)).toThrow(CourseRefNotFoundError);
  });
});

describe("findCourseRefs", () => {
  it("returns every match at the strongest level", () => {
    const matches = findCourseRefs("Calculus", COURSES);
    expect(matches.map((match) => match.course.id)).toEqual([101, 102]);
    expect(matches.every((match) => match.matchedBy === "namePartial")).toBe(true);
  });

  it("reports how a course matched", () => {
    expect(findCourseRefs("CS 201", COURSES)[0].matchedBy).toBe("code");
    expect(findCourseRefs(101, COURSES)[0].matchedBy).toBe("id");
    expect(findCourseRefs("Data Structures", COURSES)[0].matchedBy).toBe("name");
  });

  it("returns an empty list when nothing matches", () => {
    expect(findCourseRefs("Chemistry", COURSES)).toEqual([]);
  });
});
