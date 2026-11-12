/**
 * Display text for an error: `String()` for `Error` instances (keeps the
 * message), the `type` tag for plain tagged objects (avoids `[object Object]`).
 */
export function errorLabel(error: unknown): string {
  if (
    !(error instanceof Error) &&
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    typeof error.type === "string"
  ) {
    return error.type;
  }
  return String(error);
}
