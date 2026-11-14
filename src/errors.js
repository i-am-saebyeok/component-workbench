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
};

export class WorkbenchError extends Error {
  constructor(code, message_ko, details = undefined) {
    super(message_ko);
    this.name = 'WorkbenchError';
    this.code = code;
    this.details = details;
  }

  get status() {
    return HTTP_STATUS[this.code] ?? 500;
  }

  toJSON() {
    return { code: this.code, message_ko: this.message, ...(this.details === undefined ? {} : { details: this.details }) };
  }
}

export function toWorkbenchError(error) {
  if (error instanceof WorkbenchError) return error;
  return new WorkbenchError('internal_error', `처리 중 예기치 않은 오류: ${error?.message ?? error}`);
}
