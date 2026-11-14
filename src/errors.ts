// 웹 API·MCP·CLI가 같은 코드와 의미로 보고하는 단일 오류 형식.
const HTTP_STATUS = {
  invalid_request: 400,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  payload_too_large: 413,
  unsupported_media_type: 415,
  invalid_selection: 422,
  selection_conflict: 409,
  source_conflict: 409,
  selection_missing: 404,
  selection_stale: 409,
  config_invalid: 500,
  catalog_invalid: 503,
  selection_unreadable: 503,
  selection_busy: 503,
  internal_error: 500,
};

export type ErrorCode = keyof typeof HTTP_STATUS;
export type ErrorDetails = Readonly<Record<string, unknown>>;
export type ErrorJSON = { code: ErrorCode; message_ko: string; details?: ErrorDetails };

export class WorkbenchError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails | undefined;

  constructor(code: ErrorCode, message_ko: string, details?: ErrorDetails) {
    super(message_ko);
    this.name = 'WorkbenchError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }

  toJSON(): ErrorJSON {
    return { code: this.code, message_ko: this.message, ...(this.details === undefined ? {} : { details: this.details }) };
  }
}

/** throw된 값의 message. message가 없으면 값 자체를 문자열로 쓴다. */
export function messageOf(error: unknown): string {
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : undefined;
  return String(message ?? error);
}

/** Node 시스템 오류 코드(ENOENT 등). 없으면 undefined. */
export const systemCode = (error: unknown): unknown => (typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined);

export function toWorkbenchError(error: unknown): WorkbenchError {
  if (error instanceof WorkbenchError) return error;
  return new WorkbenchError('internal_error', `처리 중 예기치 않은 오류: ${messageOf(error)}`);
}
