/** Small helper so optional dependencies never break a cold checkout. */

export async function dynamicImport(moduleName: string): Promise<Record<string, unknown>> {
  const loaded = (await import(/* @vite-ignore */ moduleName)) as unknown;
  return (loaded ?? {}) as Record<string, unknown>;
}
