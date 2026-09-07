export function memoryRoute(
  _request: Request,
  _env: CloudflareBindings,
): Promise<Response | undefined> {
  void _request;
  void _env;
  return Promise.resolve(undefined);
}
export function memoryContext(
  _request: Request,
  _env: CloudflareBindings,
): Promise<{ metadata?: Record<string, unknown>; cookie?: string }> {
  void _request;
  void _env;
  return Promise.resolve({});
}
