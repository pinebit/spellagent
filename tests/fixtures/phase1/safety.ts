// Résumé 😀 comment prose.
const value = "strings are protected";

/**
 * Documentation prose is eligible.
 * @example
 * const untouched = "example code";
 */
export function example(): string {
  // spellagent-disable-next-line
  // This comment is disabled.
  return value;
}
