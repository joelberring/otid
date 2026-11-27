export class HttpStatusError extends Error {
  constructor(readonly status: number) { super(String(status)); }
}
