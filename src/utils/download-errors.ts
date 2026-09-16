
export type DownloadFailureKind =
  | "unsupportedType"
  | "undetectableType"
  | "badFilename"
  | "pathTraversal";

export class DownloadError extends Error {
  constructor(
    public readonly kind: DownloadFailureKind,
    message: string,
    public readonly detail?: string
  ) {
    super(message);
    this.name = "DownloadError";
  }
}

export function isSafeDetail(value: string): boolean {
  return value.length <= 64 && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(value);
}
