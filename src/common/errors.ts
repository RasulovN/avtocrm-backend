// DRF-ga o'xshash API xatoliklari.

export class ApiError extends Error {
  statusCode: number;
  payload: unknown;

  constructor(statusCode: number, payload: unknown) {
    super(typeof payload === 'string' ? payload : JSON.stringify(payload));
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

export class BadRequest extends ApiError {
  constructor(payload: unknown = { detail: 'Bad request' }) {
    super(400, payload);
  }
}

export class Unauthorized extends ApiError {
  constructor(payload: unknown = { detail: 'Authentication credentials were not provided.' }) {
    super(401, payload);
  }
}

export class Forbidden extends ApiError {
  constructor(payload: unknown = { detail: 'You do not have permission to perform this action.' }) {
    super(403, payload);
  }
}

export class NotFound extends ApiError {
  constructor(payload: unknown = { detail: 'Not found.' }) {
    super(404, payload);
  }
}

export class ValidationError extends ApiError {
  constructor(payload: unknown) {
    super(400, payload);
  }
}

export class TooManyRequests extends ApiError {
  constructor(payload: unknown = { detail: 'Juda ko\'p urinish. Iltimos birozdan so\'ng qayta urinib ko\'ring.' }) {
    super(429, payload);
  }
}
