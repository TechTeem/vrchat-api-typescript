import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  DEFAULT_VRCHAT_USER_AGENT,
  VRChatSessionClient,
  isCurrentUser,
  isTwoFactorChallenge,
} from "../dist/index.js";

const cookieFile = resolve(process.cwd(), ".vrchat-session.json");

const readCookieCache = async () => {
  try {
    const value = await readFile(cookieFile, "utf8");
    return JSON.parse(value);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }

    throw error;
  }
};

const writeCookieCache = async (cookies) => {
  await writeFile(cookieFile, `${JSON.stringify(cookies, null, 2)}\n`, "utf8");
};

const username = process.env.VRCHAT_USERNAME;
const password = process.env.VRCHAT_PASSWORD;
const totpCode = process.env.VRCHAT_TOTP_CODE;
const totpSecret = process.env.VRCHAT_TOTP_SECRET;
const userAgent =
  "vrchat-api-typescript-example/1.0.0 (+https://github.com/ferdyy/vrchat-api-typescript)";

const cachedCookies = await readCookieCache();
const session = new VRChatSessionClient({ cookies: cachedCookies });

if (session.hasSession()) {
  try {
    const currentUser = await session.getCurrentUser();
    if (isCurrentUser(currentUser)) {
      console.log(`Reused cached session for ${currentUser.displayName}`);
      process.exit(0);
    }
  } catch {
    session.clearCookies();
  }
}

if (!username || !password) {
  throw new Error(
    "VRCHAT_USERNAME and VRCHAT_PASSWORD are required when no valid cached cookies are available.",
  );
}

const loginResult = await session.login({ username, password, userAgent });

if (isCurrentUser(loginResult)) {
  await writeCookieCache(session.exportCookies());
  console.log(`Logged in as ${loginResult.displayName}`);
  process.exit(0);
}

if (
  isTwoFactorChallenge(loginResult) &&
  loginResult.requiresTwoFactorAuth.includes("totp")
) {
  if (!totpCode && !totpSecret) {
    throw new Error(
      "VRCHAT_TOTP_CODE or VRCHAT_TOTP_SECRET is required when the account requires TOTP.",
    );
  }

  const user = totpSecret
    ? await session.loginWithTotpSecret({
        username,
        password,
        totpSecret,
        userAgent,
      })
    : await session.loginWithTotp({
        username,
        password,
        totpCode,
        userAgent,
      });
  await writeCookieCache(session.exportCookies());
  console.log(`Logged in with TOTP as ${user.displayName}`);
  process.exit(0);
}

throw new Error(`Unsupported 2FA challenge: ${JSON.stringify(loginResult)}`);
