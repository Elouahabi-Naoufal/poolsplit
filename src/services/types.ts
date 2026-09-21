export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function fail(error: string, status: number): ServiceResult<never> {
  return { ok: false, error, status };
}
