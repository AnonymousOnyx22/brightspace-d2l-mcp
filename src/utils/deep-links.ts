

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function assignmentUrl(
  baseUrl: string,
  courseId: number,
  folderId: number
): string {
  return `${trimBaseUrl(baseUrl)}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${folderId}&grpid=0&ou=${courseId}`;
}

export function quizUrl(
  baseUrl: string,
  courseId: number,
  quizId: number
): string {
  return `${trimBaseUrl(baseUrl)}/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${quizId}&ou=${courseId}`;
}

export function gradebookUrl(baseUrl: string, courseId: number): string {
  return `${trimBaseUrl(baseUrl)}/d2l/lms/grades/my_grades/main.d2l?ou=${courseId}`;
}
