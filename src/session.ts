import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";

import {
  VRChatApiClient as GeneratedVRChatApiClient,
  type CurrentUser,
  type GetCurrentUserResponse,
  type RequiresTwoFactorAuth,
  type TwoFactorAuthType,
  type Verify2FaEmailCodeResponse,
  type Verify2FaResponse,
  type VerifyAuthTokenResponse,
  type VerifyRecoveryCodeResponse,
} from "./generated";
import { createClient, type Config } from "./generated/client";
import { VRCHAT_SPEC_VERSION } from "./spec-meta";

export const DEFAULT_VRCHAT_API_BASE_URL = "https://api.vrchat.cloud/api/1";
export const DEFAULT_VRCHAT_USER_AGENT = `vrchat-api-typescript/${VRCHAT_SPEC_VERSION} (+https://www.npmjs.com/package/vrchat-api-typescript)`;

type SessionFetch = typeof fetch;

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

export interface VRChatSessionClientOptions extends Omit<
  Config,
  "baseUrl" | "fetch" | "headers"
> {
  baseUrl?: string;
  cookieHeader?: string;
  cookies?: VRChatSessionCookies;
  fetch?: SessionFetch;
  headers?: RequestInit["headers"];
  userAgent?: string;
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

const COOKIE_PAIR_SEPARATOR = "; ";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

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

export class VRChatSessionClient {
  public readonly api: GeneratedVRChatApiClient;

  private readonly cookieJar = new CookieJar();

  constructor(options: VRChatSessionClientOptions = {}) {
    const {
      baseUrl = DEFAULT_VRCHAT_API_BASE_URL,
      cookieHeader,
      cookies,
      fetch: fetchImpl = globalThis.fetch,
      headers,
      userAgent = DEFAULT_VRCHAT_USER_AGENT,
      ...config
    } = options;

    if (cookieHeader) {
      this.cookieJar.import(cookieHeader);
    }

    if (cookies) {
      this.cookieJar.importObject(cookies);
    }

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

    this.api = new GeneratedVRChatApiClient({ client });
  }

  clearCookies(): void {
    this.cookieJar.clear();
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

  hasSession(): boolean {
    return Boolean(this.getAuthCookie());
  }

  async login(options: VRChatLoginOptions): Promise<GetCurrentUserResponse> {
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
  }

  restoreFromCookies(cookies: VRChatSessionCookies): void {
    this.cookieJar.importObject(cookies);
  }

  setAuthCookie(value: string): void {
    this.cookieJar.set({ name: "auth", value });
  }

  async logout(): Promise<void> {
    await this.api.logout(defaultDataOptions);
    this.clearCookies();
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
}
