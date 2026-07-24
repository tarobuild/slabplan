export * from "./generated/api";
export * from "./generated/api.schemas";
export {
  setBaseUrl,
  setAuthFailureHandler,
  setAuthRefreshHandler,
  setAuthTokenGetter,
  setForbiddenHandler,
  ApiError,
  ResponseParseError,
  customFetch,
} from "./custom-fetch";
export type {
  AuthFailureHandler,
  AuthRefreshHandler,
  AuthTokenGetter,
  CustomFetchOptions,
  BodyType,
  ErrorType,
  ForbiddenHandler,
} from "./custom-fetch";
