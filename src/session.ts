import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";

import {
  type AcceptFriendRequestResponse,
  type AcknowledgeNotificationV2Response,
  type ClearNotificationsResponse,
  VRChatApiClient as GeneratedVRChatApiClient,
  type CurrentUser,
  type DeleteNotificationResponse,
  type DeleteNotificationV2Response,
  type GetCurrentUserResponse,
  type InviteResponse,
  type MarkNotificationAsReadResponse,
  type NotificationId,
  type NotificationV2ResponseType,
  type ReplyNotificationV2Request,
  type ReplyNotificationV2Response,
  type RequiresTwoFactorAuth,
  type RespondInviteResponse,
  type RespondInviteWithPhotoResponse,
  type RespondNotificationV2Request,
  type RespondNotificationV2Response,
  type TwoFactorAuthType,
  type Verify2FaEmailCodeResponse,
  type Verify2FaResponse,
  type VerifyAuthTokenResponse,
  type VerifyRecoveryCodeResponse,
} from "./generated";
import { createClient, type Config } from "./generated/client";
import { VRCHAT_SPEC_VERSION } from "./spec-meta";
import {
  VRChatWebsocketClient,
  type VRChatWebsocketClientOptions,
  type VRChatWebsocketKnownMessage,
  type VRChatWebsocketMessage,
} from "./websocket";

export const DEFAULT_VRCHAT_API_BASE_URL = "https://api.vrchat.cloud/api/1";
export const DEFAULT_VRCHAT_USER_AGENT = `vrchat-api-typescript/${VRCHAT_SPEC_VERSION} (+https://www.npmjs.com/package/vrchat-api-typescript)`;

type SessionFetch = typeof fetch;
type AuthState = "authenticated" | "pending2fa" | "unauthenticated" | "unknown";
type ApiMethod = (options?: Record<string, unknown>) => Promise<unknown>;
type ApiFieldsResult<TData = unknown, TError = unknown> =
  | {
      data: TData;
      error?: undefined;
      request: Request;
      response: Response;
    }
  | {
      data?: undefined;
      error: TError;
      request: Request;
      response: Response;
    };

type StoredCookie = {
  domain?: string;
  expiresAt?: number;
  httpOnly?: boolean;
  name: string;
  path?: string;
  sameSite?: string;
  secure?: boolean;
  value: string;
};

export type VRChatSessionCookies = Record<string, string>;

export type VRChatClientMetadata = Record<string, unknown>;

export interface VRChatConnectWebsocketOptions {
  bindNotificationHandlers?: boolean;
}

export interface VRChatBindWebsocketNotificationHandlersOptions {
  onError?: (
    error: Error,
    message: VRChatWebsocketNotificationDirectiveMessage,
  ) => void;
}

export interface VRChatSessionIdentity {
  displayName?: CurrentUser["displayName"];
  id?: CurrentUser["id"];
  isAuthenticated: boolean;
  label?: string;
  metadata?: Readonly<VRChatClientMetadata>;
  username?: CurrentUser["username"];
}

export interface VRChatSessionClientOptions extends Omit<
  Config,
  "baseUrl" | "fetch" | "headers"
> {
  baseUrl?: string;
  cookieHeader?: string;
  cookies?: VRChatSessionCookies;
  fetch?: SessionFetch;
  headers?: RequestInit["headers"];
  label?: string;
  metadata?: VRChatClientMetadata;
  userAgent?: string;
  websocket?: Omit<VRChatWebsocketClientOptions, "authToken">;
}

export interface VRChatLoginOptions {
  headers?: RequestInit["headers"];
  password: string;
  username: string;
  userAgent?: string;
}

export interface VRChatLoginWithTotpOptions extends VRChatLoginOptions {
  totpCode: string;
}

export interface TotpGenerateOptions {
  algorithm?: "SHA1" | "SHA256" | "SHA512";
  digits?: number;
  period?: number;
  timestamp?: number;
}

export interface VRChatLoginWithTotpSecretOptions extends VRChatLoginOptions {
  totp?: TotpGenerateOptions;
  totpSecret: string;
}

export interface VRChatTwoFactorOptions {
  code: string;
  type: TwoFactorAuthType;
}

export interface VRChatErrorPayload {
  error: {
    message?: string;
    retry_after?: number;
    retry_after_ms?: number;
    status_code: number;
    [key: string]: unknown;
  };
}

export interface VRChatNotificationV2RespondOptions {
  notificationId: NotificationId;
  responseData?: string;
  responseType: NotificationV2ResponseType;
}

export interface VRChatNotificationV2ReplyOptions {
  body: ReplyNotificationV2Request;
  notificationId: NotificationId;
}

export interface VRChatInviteNotificationResponseOptions {
  notificationId: NotificationId;
  responseSlot: InviteResponse["responseSlot"];
}

export interface VRChatInviteNotificationPhotoResponseOptions extends VRChatInviteNotificationResponseOptions {
  image: Blob | File;
}

type VRChatWebsocketNotificationDirectiveMessage = Pick<
  VRChatWebsocketKnownMessage | VRChatWebsocketMessage,
  "content" | "type"
>;

export class VRChatApiError<TBody = unknown> extends Error {
  readonly body: TBody;
  readonly request: Request;
  readonly response: Response;
  readonly retryAfter?: number;
  readonly retryAfterMs?: number;
  readonly status: number;

  constructor({
    body,
    request,
    response,
    retryAfter,
    retryAfterMs,
  }: {
    body: TBody;
    request: Request;
    response: Response;
    retryAfter?: number;
    retryAfterMs?: number;
  }) {
    super(getErrorMessage(body, response.status));
    this.name = "VRChatApiError";
    this.body = body;
    this.request = request;
    this.response = response;
    this.retryAfter = retryAfter;
    this.retryAfterMs = retryAfterMs;
    this.status = response.status;
  }
}

const COOKIE_PAIR_SEPARATOR = "; ";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const LOGIN_RATE_LIMIT_BUFFER_MS = 3000;

const splitCookieHeader = (cookieHeader: string): Array<string> => {
  return cookieHeader
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean);
};

const splitSetCookieHeader = (header: string): Array<string> => {
  const values: Array<string> = [];
  let current = "";
  let inExpires = false;

  for (let index = 0; index < header.length; index += 1) {
    const character = header[index] || "";
    const recent = `${current}${character}`.toLowerCase();

    if (!inExpires && recent.endsWith("expires=")) {
      inExpires = true;
    }

    if (character === "," && !inExpires) {
      if (current.trim()) {
        values.push(current.trim());
      }
      current = "";
      continue;
    }

    current += character;

    if (inExpires && character === ";") {
      inExpires = false;
    }
  }

  if (current.trim()) {
    values.push(current.trim());
  }

  return values;
};

const getSetCookieHeaders = (headers: Headers): Array<string> => {
  const setCookieHeaders = (
    headers as Headers & { getSetCookie?: () => Array<string> }
  ).getSetCookie?.();
  if (setCookieHeaders && setCookieHeaders.length > 0) {
    return setCookieHeaders;
  }

  const header = headers.get("set-cookie");
  return header ? splitSetCookieHeader(header) : [];
};

const mergeCookieHeaders = (
  existingHeader: string | null,
  jarHeader: string,
): string => {
  if (!existingHeader?.trim()) {
    return jarHeader;
  }

  const existingNames = new Set(
    splitCookieHeader(existingHeader)
      .map((segment) => segment.split("=", 1)[0]?.trim())
      .filter((name): name is string => Boolean(name)),
  );

  const mergedSegments = [...splitCookieHeader(existingHeader)];

  for (const segment of splitCookieHeader(jarHeader)) {
    const name = segment.split("=", 1)[0]?.trim();
    if (!name || existingNames.has(name)) {
      continue;
    }
    mergedSegments.push(segment);
  }

  return mergedSegments.join(COOKIE_PAIR_SEPARATOR);
};

class CookieJar {
  private readonly cookies = new Map<string, StoredCookie>();

  clear(): void {
    this.cookies.clear();
  }

  export(): VRChatSessionCookies {
    const result: VRChatSessionCookies = {};

    for (const cookie of this.getActiveCookies()) {
      result[cookie.name] = cookie.value;
    }

    return result;
  }

  get(name: string): string | undefined {
    const cookie = this.cookies.get(name);
    if (!cookie) {
      return undefined;
    }

    if (cookie.expiresAt && cookie.expiresAt <= Date.now()) {
      this.cookies.delete(name);
      return undefined;
    }

    return cookie.value;
  }

  import(header: string): void {
    for (const segment of splitCookieHeader(header)) {
      const separatorIndex = segment.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const name = segment.slice(0, separatorIndex).trim();
      const value = segment.slice(separatorIndex + 1).trim();
      this.set({ name, value });
    }
  }

  importObject(cookies: VRChatSessionCookies): void {
    for (const [name, value] of Object.entries(cookies)) {
      this.set({ name, value });
    }
  }

  set(
    cookie: Pick<StoredCookie, "name" | "value"> &
      Partial<Omit<StoredCookie, "name" | "value">>,
  ): void {
    const expiresAt = cookie.expiresAt;
    if (
      (expiresAt !== undefined && expiresAt <= Date.now()) ||
      cookie.value === ""
    ) {
      this.cookies.delete(cookie.name);
      return;
    }

    this.cookies.set(cookie.name, {
      ...this.cookies.get(cookie.name),
      ...cookie,
    });
  }

  setFromSetCookieHeader(header: string): void {
    const parts = header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      return;
    }

    const [nameValue, ...attributes] = parts;
    const separatorIndex = nameValue.indexOf("=");
    if (separatorIndex <= 0) {
      return;
    }

    const storedCookie: StoredCookie = {
      name: nameValue.slice(0, separatorIndex).trim(),
      value: nameValue.slice(separatorIndex + 1).trim(),
    };

    for (const attribute of attributes) {
      const [rawKey, ...rawValueParts] = attribute.split("=");
      const key = rawKey.trim().toLowerCase();
      const value = rawValueParts.join("=").trim();

      switch (key) {
        case "domain":
          storedCookie.domain = value || undefined;
          break;
        case "expires": {
          const expiresAt = Date.parse(value);
          if (!Number.isNaN(expiresAt)) {
            storedCookie.expiresAt = expiresAt;
          }
          break;
        }
        case "httponly":
          storedCookie.httpOnly = true;
          break;
        case "max-age": {
          const maxAgeSeconds = Number.parseInt(value, 10);
          if (!Number.isNaN(maxAgeSeconds)) {
            storedCookie.expiresAt = Date.now() + maxAgeSeconds * 1000;
          }
          break;
        }
        case "path":
          storedCookie.path = value || undefined;
          break;
        case "samesite":
          storedCookie.sameSite = value || undefined;
          break;
        case "secure":
          storedCookie.secure = true;
          break;
        default:
          break;
      }
    }

    this.set(storedCookie);
  }

  toHeader(url: URL): string {
    return this.getActiveCookies()
      .filter((cookie) => !cookie.secure || url.protocol === "https:")
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join(COOKIE_PAIR_SEPARATOR);
  }

  updateFromResponse(response: Response): void {
    for (const header of getSetCookieHeaders(response.headers)) {
      this.setFromSetCookieHeader(header);
    }
  }

  private getActiveCookies(): Array<StoredCookie> {
    const now = Date.now();
    const activeCookies: Array<StoredCookie> = [];

    for (const [name, cookie] of this.cookies.entries()) {
      if (cookie.expiresAt && cookie.expiresAt <= now) {
        this.cookies.delete(name);
        continue;
      }

      activeCookies.push(cookie);
    }

    return activeCookies;
  }
}

const createSessionFetch = (
  cookieJar: CookieJar,
  fetchImpl: SessionFetch,
): SessionFetch => {
  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const headers = new Headers(request.headers);
    const cookieHeader = cookieJar.toHeader(new URL(request.url));

    if (cookieHeader) {
      headers.set(
        "Cookie",
        mergeCookieHeaders(headers.get("Cookie"), cookieHeader),
      );
    }

    const requestWithCookies = new Request(request, { headers });
    const response = await fetchImpl(requestWithCookies);
    cookieJar.updateFromResponse(response);
    return response;
  };
};

const buildBasicAuthHeader = (username: string, password: string): string => {
  const credentials = Buffer.from(`${username}:${password}`, "utf8").toString(
    "base64",
  );
  return `Basic ${credentials}`;
};

const setUserAgentHeader = (headers: Headers, userAgent?: string): void => {
  if (userAgent) {
    headers.set("User-Agent", userAgent);
  }
};

const sleep = async (milliseconds: number): Promise<void> => {
  if (milliseconds <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

const getErrorMessage = (body: unknown, fallbackStatus: number): string => {
  if (
    typeof body === "object" &&
    body &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }

  if (typeof body === "string" && body.trim()) {
    return body;
  }

  return `VRChat API request failed with status ${fallbackStatus}.`;
};

const getRetryAfterMilliseconds = (response: Response): number | undefined => {
  const retryAfterHeader = response.headers.get("Retry-After");
  if (!retryAfterHeader) {
    return undefined;
  }

  const seconds = Number.parseInt(retryAfterHeader, 10);
  if (!Number.isNaN(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const timestamp = Date.parse(retryAfterHeader);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  return Math.max(0, timestamp - Date.now());
};

const createErrorPayload = (
  status: number,
  message: string,
  extras: Record<string, unknown> = {},
): VRChatErrorPayload => ({
  error: {
    message,
    status_code: status,
    ...extras,
  },
});

const mergeRetryAfterIntoError = (
  body: unknown,
  status: number,
  retryAfterMs?: number,
): unknown => {
  if (retryAfterMs === undefined) {
    return body;
  }

  const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000));

  if (typeof body === "object" && body && "error" in body) {
    const error = body.error;
    if (typeof error === "object" && error) {
      return {
        ...body,
        error: {
          ...error,
          retry_after: retryAfter,
          retry_after_ms: retryAfterMs,
          status_code:
            "status_code" in error && typeof error.status_code === "number"
              ? error.status_code
              : status,
        },
      };
    }
  }

  return createErrorPayload(status, getErrorMessage(body, status), {
    retry_after: retryAfter,
    retry_after_ms: retryAfterMs,
  });
};

const createSyntheticRequest = (baseUrl: string, methodName: string): Request =>
  new Request(`${baseUrl.replace(/\/$/, "")}/__local__/${methodName}`);

const createSyntheticResponse = (
  status: number,
  body: unknown,
  retryAfterMs?: number,
): Response => {
  const headers = new Headers({
    "Content-Type": "application/json",
  });

  if (retryAfterMs !== undefined) {
    headers.set(
      "Retry-After",
      String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
    );
  }

  return new Response(JSON.stringify(body), {
    headers,
    status,
  });
};

const isErrorResult = <TData, TError>(
  result: ApiFieldsResult<TData, TError>,
): result is Extract<ApiFieldsResult<TData, TError>, { error: TError }> => {
  return result.error !== undefined;
};

const decodeBase32 = (value: string): Buffer => {
  const normalizedValue = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  if (!normalizedValue) {
    throw new Error("TOTP secret is empty or not valid base32.");
  }

  let bits = "";

  for (const character of normalizedValue) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      throw new Error("TOTP secret contains invalid base32 characters.");
    }

    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: Array<number> = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
};

export const generateTotpCode = (
  secret: string,
  options: TotpGenerateOptions = {},
): string => {
  const {
    algorithm = "SHA1",
    digits = 6,
    period = 30,
    timestamp = Date.now(),
  } = options;

  if (digits <= 0) {
    throw new Error("TOTP digits must be greater than zero.");
  }

  if (period <= 0) {
    throw new Error("TOTP period must be greater than zero.");
  }

  const counter = Math.floor(timestamp / 1000 / period);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac(algorithm.toLowerCase(), decodeBase32(secret))
    .update(counterBuffer)
    .digest();

  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(code % 10 ** digits).padStart(digits, "0");
};

const defaultDataOptions = {
  responseStyle: "fields" as const,
  throwOnError: true as const,
};

const unwrapData = <T>(result: { data: T }): T => result.data;

export const isTwoFactorChallenge = (
  value: GetCurrentUserResponse,
): value is RequiresTwoFactorAuth => {
  return Array.isArray((value as RequiresTwoFactorAuth).requiresTwoFactorAuth);
};

export const isCurrentUser = (
  value: GetCurrentUserResponse,
): value is CurrentUser => {
  return !isTwoFactorChallenge(value);
};

export class VRChatNotificationClient {
  constructor(private readonly session: VRChatSessionClient) {}

  async acceptFriendRequest(
    notificationId: NotificationId,
  ): Promise<AcceptFriendRequestResponse> {
    return unwrapData(
      await this.session.api.acceptFriendRequest({
        ...defaultDataOptions,
        path: { notificationId },
      }),
    );
  }

  async acknowledgeV2(
    notificationId: NotificationId,
  ): Promise<AcknowledgeNotificationV2Response> {
    return unwrapData(
      await this.session.api.acknowledgeNotificationV2({
        ...defaultDataOptions,
        path: { notificationId },
      }),
    );
  }

  async clearAll(): Promise<ClearNotificationsResponse> {
    return unwrapData(
      await this.session.api.clearNotifications(defaultDataOptions),
    );
  }

  async deleteV2(
    notificationId: NotificationId,
  ): Promise<DeleteNotificationV2Response> {
    return unwrapData(
      await this.session.api.deleteNotificationV2({
        ...defaultDataOptions,
        path: { notificationId },
      }),
    );
  }

  async handleWebsocketMessage(
    message: VRChatWebsocketNotificationDirectiveMessage,
  ): Promise<
    | ClearNotificationsResponse
    | DeleteNotificationResponse
    | MarkNotificationAsReadResponse
    | undefined
  > {
    switch (message.type) {
      case "clear-notification":
        return this.clearAll();
      case "hide-notification":
        if (typeof message.content !== "string") {
          return undefined;
        }
        return this.hide(message.content);
      case "see-notification":
        if (typeof message.content !== "string") {
          return undefined;
        }
        return this.markAsRead(message.content);
      default:
        return undefined;
    }
  }

  async hide(
    notificationId: NotificationId,
  ): Promise<DeleteNotificationResponse> {
    return unwrapData(
      await this.session.api.deleteNotification({
        ...defaultDataOptions,
        path: { notificationId },
      }),
    );
  }

  async markAsRead(
    notificationId: NotificationId,
  ): Promise<MarkNotificationAsReadResponse> {
    return unwrapData(
      await this.session.api.markNotificationAsRead({
        ...defaultDataOptions,
        path: { notificationId },
      }),
    );
  }

  async replyV2(
    options: VRChatNotificationV2ReplyOptions,
  ): Promise<ReplyNotificationV2Response> {
    return unwrapData(
      await this.session.api.replyNotificationV2({
        ...defaultDataOptions,
        body: options.body,
        path: { notificationId: options.notificationId },
      }),
    );
  }

  async respondInvite(
    options: VRChatInviteNotificationResponseOptions,
  ): Promise<RespondInviteResponse> {
    return unwrapData(
      await this.session.api.respondInvite({
        ...defaultDataOptions,
        body: { responseSlot: options.responseSlot },
        path: { notificationId: options.notificationId },
      }),
    );
  }

  async respondInviteWithPhoto(
    options: VRChatInviteNotificationPhotoResponseOptions,
  ): Promise<RespondInviteWithPhotoResponse> {
    return unwrapData(
      await this.session.api.respondInviteWithPhoto({
        ...defaultDataOptions,
        body: {
          data: { responseSlot: options.responseSlot },
          image: options.image,
        },
        path: { notificationId: options.notificationId },
      }),
    );
  }

  async respondV2(
    options: VRChatNotificationV2RespondOptions,
  ): Promise<RespondNotificationV2Response> {
    const body: RespondNotificationV2Request = {
      responseType: options.responseType,
    };

    if (options.responseData !== undefined) {
      body.responseData = options.responseData;
    }

    return unwrapData(
      await this.session.api.respondNotificationV2({
        ...defaultDataOptions,
        body,
        path: { notificationId: options.notificationId },
      }),
    );
  }
}

export class VRChatSessionClient {
  public readonly api: GeneratedVRChatApiClient;
  public readonly label?: string;
  public readonly metadata?: Readonly<VRChatClientMetadata>;
  public readonly notifications: VRChatNotificationClient;
  public readonly websocket: VRChatWebsocketClient;

  private authenticatedUser?: CurrentUser;
  private authState: AuthState;
  private readonly apiCooldowns = new Map<string, number>();
  private readonly cookieJar = new CookieJar();
  private readonly rawApi: GeneratedVRChatApiClient;
  private loginCooldownUntil = 0;
  private readonly sessionBaseUrl: string;
  private websocketNotificationUnsubscribe?: () => void;

  constructor(options: VRChatSessionClientOptions = {}) {
    const {
      baseUrl = DEFAULT_VRCHAT_API_BASE_URL,
      cookieHeader,
      cookies,
      fetch: fetchImpl = globalThis.fetch,
      headers,
      label,
      metadata,
      userAgent = DEFAULT_VRCHAT_USER_AGENT,
      websocket,
      ...config
    } = options;

    if (cookieHeader) {
      this.cookieJar.import(cookieHeader);
    }

    if (cookies) {
      this.cookieJar.importObject(cookies);
    }

    this.sessionBaseUrl = baseUrl;
    this.authState = this.getAuthCookie() ? "unknown" : "unauthenticated";
    this.label = label;
    this.metadata = metadata ? { ...metadata } : undefined;

    const defaultHeaders = new Headers(headers);
    if (!defaultHeaders.has("User-Agent")) {
      defaultHeaders.set("User-Agent", userAgent);
    }

    const client = createClient({
      ...config,
      baseUrl,
      fetch: createSessionFetch(this.cookieJar, fetchImpl),
      headers: defaultHeaders,
    });

    this.rawApi = new GeneratedVRChatApiClient({ client });
    this.api = this.createApiProxy();
    this.notifications = new VRChatNotificationClient(this);

    const websocketHeaders = new Headers(defaultHeaders);
    for (const [name, value] of new Headers(websocket?.headers).entries()) {
      websocketHeaders.set(name, value);
    }

    this.websocket = new VRChatWebsocketClient({
      ...websocket,
      authToken: this.getAuthCookie(),
      headers: websocketHeaders,
      label: websocket?.label ?? label,
      metadata: websocket?.metadata ?? metadata,
    });
  }

  clearCookies(): void {
    this.cookieJar.clear();
    this.clearAuthenticatedUser();
    this.authState = "unauthenticated";
    this.syncWebsocketAuth();
  }

  get authenticatedDisplayName(): CurrentUser["displayName"] | undefined {
    return this.authenticatedUser?.displayName;
  }

  get authenticatedUserId(): CurrentUser["id"] | undefined {
    return this.authenticatedUser?.id;
  }

  get authenticatedUsername(): CurrentUser["username"] | undefined {
    return this.authenticatedUser?.username;
  }

  get currentIdentity(): VRChatSessionIdentity {
    return {
      displayName: this.authenticatedDisplayName,
      id: this.authenticatedUserId,
      isAuthenticated: Boolean(this.authenticatedUser),
      label: this.label,
      metadata: this.metadata,
      username: this.authenticatedUsername,
    };
  }

  get currentUser(): CurrentUser | undefined {
    return this.authenticatedUser;
  }

  exportCookies(): VRChatSessionCookies {
    return this.cookieJar.export();
  }

  getAuthCookie(): string | undefined {
    return this.cookieJar.get("auth");
  }

  getCookieHeader(): string {
    return Object.entries(this.exportCookies())
      .map(([name, value]) => `${name}=${value}`)
      .join(COOKIE_PAIR_SEPARATOR);
  }

  async getCurrentUser(): Promise<GetCurrentUserResponse> {
    return unwrapData(await this.api.getCurrentUser(defaultDataOptions));
  }

  async connectWebsocket(
    options: VRChatConnectWebsocketOptions = {},
  ): Promise<VRChatWebsocketClient> {
    const authResult = await this.ensureAuthenticated("connectWebsocket", {
      throwOnError: true,
    });
    if (authResult) {
      throw new Error("Failed to authenticate websocket session.");
    }

    const authCookie = this.getAuthCookie();
    if (!authCookie) {
      throw new Error(
        "This VRChat session is not authenticated. Call login() first.",
      );
    }

    await this.websocket.authenticate(authCookie);

    if (options.bindNotificationHandlers) {
      this.bindWebsocketNotificationHandlers();
    }

    return this.websocket;
  }

  bindWebsocketNotificationHandlers(
    options: VRChatBindWebsocketNotificationHandlersOptions = {},
  ): () => void {
    if (this.websocketNotificationUnsubscribe) {
      return this.websocketNotificationUnsubscribe;
    }

    const handleMessage = (
      message: VRChatWebsocketKnownMessage | VRChatWebsocketMessage,
    ): void => {
      void this.notifications.handleWebsocketMessage(message).catch((error) => {
        const normalizedError =
          error instanceof Error
            ? error
            : new Error("Failed to handle VRChat websocket notification.");
        options.onError?.(normalizedError, message);
      });
    };

    const unsubscribe = (): void => {
      this.websocket.off("message", handleMessage);
      if (this.websocketNotificationUnsubscribe === unsubscribe) {
        this.websocketNotificationUnsubscribe = undefined;
      }
    };

    this.websocket.on("message", handleMessage);
    this.websocketNotificationUnsubscribe = unsubscribe;
    return unsubscribe;
  }

  hasSession(): boolean {
    return Boolean(this.getAuthCookie());
  }

  async requireCurrentUser(): Promise<CurrentUser> {
    if (this.authenticatedUser) {
      return this.authenticatedUser;
    }

    const currentUser = await this.getCurrentUser();
    if (!isCurrentUser(currentUser)) {
      throw new Error("This VRChat session is not fully authenticated yet.");
    }

    return currentUser;
  }

  async resolveIdentity(): Promise<VRChatSessionIdentity> {
    if (this.hasSession() && !this.authenticatedUser) {
      try {
        await this.requireCurrentUser();
      } catch {
        return this.currentIdentity;
      }
    }

    return this.currentIdentity;
  }

  async login(options: VRChatLoginOptions): Promise<GetCurrentUserResponse> {
    const restoredSession = await this.tryReuseCookieSession();
    if (restoredSession) {
      return restoredSession;
    }

    const headers = new Headers(options.headers);
    setUserAgentHeader(headers, options.userAgent);
    headers.set(
      "Authorization",
      buildBasicAuthHeader(options.username, options.password),
    );

    return unwrapData(
      await this.api.getCurrentUser({
        ...defaultDataOptions,
        headers,
      }),
    );
  }

  async loginWithTotp(
    options: VRChatLoginWithTotpOptions,
  ): Promise<CurrentUser> {
    const loginResult = await this.login(options);

    if (isCurrentUser(loginResult)) {
      return loginResult;
    }

    if (!loginResult.requiresTwoFactorAuth.includes("totp")) {
      throw new Error(
        `Login requires unsupported 2FA methods: ${loginResult.requiresTwoFactorAuth.join(", ")}`,
      );
    }

    await this.verify2Fa(options.totpCode);

    const currentUser = await this.getCurrentUser();
    if (!isCurrentUser(currentUser)) {
      throw new Error(
        "TOTP verification completed but the API still requires additional verification.",
      );
    }

    return currentUser;
  }

  async loginWithTotpSecret(
    options: VRChatLoginWithTotpSecretOptions,
  ): Promise<CurrentUser> {
    return this.loginWithTotp({
      ...options,
      totpCode: generateTotpCode(options.totpSecret, options.totp),
    });
  }

  restoreFromCookieHeader(cookieHeader: string): void {
    this.cookieJar.import(cookieHeader);
    this.clearAuthenticatedUser();
    this.authState = this.getAuthCookie() ? "unknown" : "unauthenticated";
    this.syncWebsocketAuth();
  }

  restoreFromCookies(cookies: VRChatSessionCookies): void {
    this.cookieJar.importObject(cookies);
    this.clearAuthenticatedUser();
    this.authState = this.getAuthCookie() ? "unknown" : "unauthenticated";
    this.syncWebsocketAuth();
  }

  setAuthCookie(value: string): void {
    this.cookieJar.set({ name: "auth", value });
    this.clearAuthenticatedUser();
    this.authState = value ? "unknown" : "unauthenticated";
    this.syncWebsocketAuth();
  }

  async logout(): Promise<void> {
    await this.api.logout(defaultDataOptions);
    this.clearAuthenticatedUser();
    this.clearCookies();
    this.authState = "unauthenticated";
  }

  unbindWebsocketNotificationHandlers(): void {
    this.websocketNotificationUnsubscribe?.();
  }

  async verify2Fa(code: string): Promise<Verify2FaResponse> {
    return unwrapData(
      await this.api.verify2Fa({
        ...defaultDataOptions,
        body: { code },
      }),
    );
  }

  async verify2FaWithSecret(
    secret: string,
    options?: TotpGenerateOptions,
  ): Promise<Verify2FaResponse> {
    return this.verify2Fa(generateTotpCode(secret, options));
  }

  async verify2FaEmailCode(code: string): Promise<Verify2FaEmailCodeResponse> {
    return unwrapData(
      await this.api.verify2FaEmailCode({
        ...defaultDataOptions,
        body: { code },
      }),
    );
  }

  async verifyAuthToken(): Promise<VerifyAuthTokenResponse> {
    return unwrapData(await this.api.verifyAuthToken(defaultDataOptions));
  }

  async verifyRecoveryCode(code: string): Promise<VerifyRecoveryCodeResponse> {
    return unwrapData(
      await this.api.verifyRecoveryCode({
        ...defaultDataOptions,
        body: { code },
      }),
    );
  }

  async verifyTwoFactor(
    options: VRChatTwoFactorOptions,
  ): Promise<
    Verify2FaEmailCodeResponse | Verify2FaResponse | VerifyRecoveryCodeResponse
  > {
    switch (options.type) {
      case "emailOtp":
        return this.verify2FaEmailCode(options.code);
      case "otp":
        return this.verifyRecoveryCode(options.code);
      case "totp":
        return this.verify2Fa(options.code);
      default:
        throw new Error(`Unsupported 2FA type: ${String(options.type)}`);
    }
  }

  private createApiProxy(): GeneratedVRChatApiClient {
    return new Proxy(this.rawApi, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver);
        if (typeof property !== "string" || typeof value !== "function") {
          return value;
        }

        return (options?: Record<string, unknown>) =>
          this.invokeApiMethod(property, value.bind(target), options);
      },
    }) as GeneratedVRChatApiClient;
  }

  private async tryReuseCookieSession(): Promise<
    GetCurrentUserResponse | undefined
  > {
    if (!this.getAuthCookie()) {
      return undefined;
    }

    try {
      return await this.getCurrentUser();
    } catch (error) {
      if (!(error instanceof VRChatApiError) || error.status !== 401) {
        throw error;
      }

      // Clear stale cookies so the fallback credential login can establish
      // a fresh session without the old auth cookie taking precedence.
      this.clearCookies();
      this.authState = "unauthenticated";
      return undefined;
    }
  }

  private async callRawApi(
    method: ApiMethod,
    options?: Record<string, unknown>,
  ): Promise<ApiFieldsResult> {
    return method({
      ...(options ?? {}),
      responseStyle: "fields",
      throwOnError: false,
    }) as Promise<ApiFieldsResult>;
  }

  private createImmediateErrorResult(
    methodName: string,
    status: number,
    body: unknown,
    retryAfterMs?: number,
  ): ApiFieldsResult {
    const request = createSyntheticRequest(this.sessionBaseUrl, methodName);
    const response = createSyntheticResponse(status, body, retryAfterMs);

    return {
      data: undefined,
      error: body,
      request,
      response,
    };
  }

  private throwApiError(result: ApiFieldsResult, retryAfterMs?: number): never {
    throw new VRChatApiError({
      body: isErrorResult(result) ? result.error : undefined,
      request: result.request,
      response: result.response,
      retryAfter: retryAfterMs
        ? Math.max(1, Math.ceil(retryAfterMs / 1000))
        : undefined,
      retryAfterMs,
    });
  }

  private finalizeResult(
    methodName: string,
    options: Record<string, unknown> | undefined,
    result: ApiFieldsResult,
  ): ApiFieldsResult {
    if (!isErrorResult(result)) {
      this.updateAuthStateFromSuccess(methodName, result.data);
      this.syncWebsocketAuth();
      return result;
    }

    this.updateAuthStateFromError(result.response.status);
    this.syncWebsocketAuth();

    if (options?.throwOnError) {
      this.throwApiError(result, getRetryAfterMilliseconds(result.response));
    }

    return result;
  }

  private getApiCooldownResult(
    methodName: string,
    options: Record<string, unknown> | undefined,
  ): ApiFieldsResult | never | undefined {
    const cooldownUntil = this.apiCooldowns.get(methodName);
    if (!cooldownUntil || cooldownUntil <= Date.now()) {
      this.apiCooldowns.delete(methodName);
      return undefined;
    }

    const retryAfterMs = cooldownUntil - Date.now();
    const body = mergeRetryAfterIntoError(
      createErrorPayload(429, `Rate limited for ${methodName}.`),
      429,
      retryAfterMs,
    );
    const result = this.createImmediateErrorResult(
      methodName,
      429,
      body,
      retryAfterMs,
    );

    if (options?.throwOnError) {
      this.throwApiError(result, retryAfterMs);
    }

    return result;
  }

  private async ensureAuthenticated(
    methodName: string,
    options: Record<string, unknown> | undefined,
  ): Promise<ApiFieldsResult | undefined> {
    if (this.authState === "authenticated") {
      return undefined;
    }

    if (this.authState === "pending2fa") {
      const result = this.createImmediateErrorResult(
        methodName,
        401,
        createErrorPayload(
          401,
          "This VRChat session has not completed 2FA yet. Only login methods may be called.",
        ),
      );

      if (options?.throwOnError) {
        this.throwApiError(result);
      }

      return result;
    }

    if (!this.getAuthCookie()) {
      this.authState = "unauthenticated";

      const result = this.createImmediateErrorResult(
        methodName,
        401,
        createErrorPayload(
          401,
          "This VRChat session is not authenticated. Call login() first.",
        ),
      );

      if (options?.throwOnError) {
        this.throwApiError(result);
      }

      return result;
    }

    if (this.authState === "unknown") {
      const verificationResult = await this.callRawApi(
        this.rawApi.verifyAuthToken.bind(this.rawApi),
      );

      if (!isErrorResult(verificationResult)) {
        this.authState = "authenticated";
        return undefined;
      }

      if (verificationResult.response.status === 401) {
        this.authState = "unauthenticated";

        const result = this.createImmediateErrorResult(
          methodName,
          401,
          verificationResult.error,
        );

        if (options?.throwOnError) {
          this.throwApiError(result);
        }

        return result;
      }

      const retryAfterMs = getRetryAfterMilliseconds(
        verificationResult.response,
      );
      const body = mergeRetryAfterIntoError(
        verificationResult.error,
        verificationResult.response.status,
        retryAfterMs,
      );
      const result = this.createImmediateErrorResult(
        methodName,
        verificationResult.response.status,
        body,
        retryAfterMs,
      );

      if (options?.throwOnError) {
        this.throwApiError(result, retryAfterMs);
      }

      return result;
    }

    return undefined;
  }

  private isLoginApiCall(
    methodName: string,
    options?: Record<string, unknown>,
  ): boolean {
    if (
      methodName === "verify2Fa" ||
      methodName === "verify2FaEmailCode" ||
      methodName === "verifyRecoveryCode"
    ) {
      return true;
    }

    if (methodName !== "getCurrentUser") {
      return false;
    }

    return new Headers(options?.headers as RequestInit["headers"]).has(
      "Authorization",
    );
  }

  private async invokeApiMethod(
    methodName: string,
    method: ApiMethod,
    options?: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.isLoginApiCall(methodName, options)) {
      return this.invokeLoginApiMethod(methodName, method, options);
    }

    const authResult = await this.ensureAuthenticated(methodName, options);
    if (authResult) {
      return authResult;
    }

    const cooldownResult = this.getApiCooldownResult(methodName, options);
    if (cooldownResult) {
      return cooldownResult;
    }

    const result = await this.callRawApi(method, options);
    if (isErrorResult(result) && result.response.status === 429) {
      const retryAfterMs = getRetryAfterMilliseconds(result.response) ?? 0;
      this.apiCooldowns.set(methodName, Date.now() + retryAfterMs);
      const body = mergeRetryAfterIntoError(result.error, 429, retryAfterMs);
      const immediateResult = this.createImmediateErrorResult(
        methodName,
        429,
        body,
        retryAfterMs,
      );

      if (options?.throwOnError) {
        this.throwApiError(immediateResult, retryAfterMs);
      }

      return immediateResult;
    }

    return this.finalizeResult(methodName, options, result);
  }

  private async invokeLoginApiMethod(
    methodName: string,
    method: ApiMethod,
    options?: Record<string, unknown>,
  ): Promise<unknown> {
    while (true) {
      const waitMs = this.loginCooldownUntil - Date.now();
      if (waitMs > 0) {
        await sleep(waitMs);
      }

      const result = await this.callRawApi(method, options);
      if (!isErrorResult(result) || result.response.status !== 429) {
        return this.finalizeResult(methodName, options, result);
      }

      const retryAfterMs =
        (getRetryAfterMilliseconds(result.response) ?? 0) +
        LOGIN_RATE_LIMIT_BUFFER_MS;
      this.loginCooldownUntil = Date.now() + retryAfterMs;
      await sleep(retryAfterMs);
    }
  }

  private updateAuthStateFromError(status: number): void {
    if (status === 401) {
      this.clearAuthenticatedUser();
      this.authState = "unauthenticated";
    }
  }

  private updateAuthStateFromSuccess(methodName: string, data: unknown): void {
    if (methodName === "logout") {
      this.clearAuthenticatedUser();
      this.authState = "unauthenticated";
      return;
    }

    if (methodName === "getCurrentUser") {
      this.authenticatedUser = isCurrentUser(data as GetCurrentUserResponse)
        ? (data as CurrentUser)
        : undefined;
      this.authState = isCurrentUser(data as GetCurrentUserResponse)
        ? "authenticated"
        : "pending2fa";
      return;
    }

    if (
      (methodName === "verify2Fa" ||
        methodName === "verify2FaEmailCode" ||
        methodName === "verifyRecoveryCode") &&
      typeof data === "object" &&
      data &&
      "verified" in data &&
      data.verified === true
    ) {
      this.authState = "authenticated";
      return;
    }

    if (methodName === "verifyAuthToken") {
      this.authState = "authenticated";
    }
  }

  private syncWebsocketAuth(): void {
    this.websocket.setAuthToken(this.getAuthCookie());
  }

  private clearAuthenticatedUser(): void {
    this.authenticatedUser = undefined;
  }
}
