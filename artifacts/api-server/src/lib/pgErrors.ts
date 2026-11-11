/** True when a Postgres error (possibly wrapped by Drizzle) is a unique-constraint violation. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const candidates = [error, (error as { cause?: unknown })?.cause];
  return candidates.some((e) => {
    const pg = e as { code?: string; constraint?: string } | undefined;
    return pg?.code === "23505" && (!constraint || pg.constraint === constraint);
  });
}
