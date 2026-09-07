export async function memoryRoute(
  _request: Request,
  _env: CloudflareBindings,
): Promise<Response | undefined> {
  return undefined;
}
export async function memoryContext(
  _request: Request,
  _env: CloudflareBindings,
): Promise<{ metadata?: Record<string, unknown>; cookie?: string }> {
  return {};
}
