import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
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

const session = new VRChatSessionClient({
  cookies: await readCookieCache(),
  label: process.env.VRCHAT_SESSION_LABEL ?? "primary-account",
  metadata: {
    accountSlot: process.env.VRCHAT_ACCOUNT_SLOT ?? "primary",
  },
  websocket: {
    autoReconnect: true,
  },
});

if (!session.hasSession()) {
  if (!username || !password) {
    throw new Error(
      "VRCHAT_USERNAME and VRCHAT_PASSWORD are required when no saved session is available.",
    );
  }

  const loginResult = await session.login({ username, password });

  if (isCurrentUser(loginResult)) {
    await writeCookieCache(session.exportCookies());
  } else if (
    isTwoFactorChallenge(loginResult) &&
    loginResult.requiresTwoFactorAuth.includes("totp")
  ) {
    if (!totpCode && !totpSecret) {
      throw new Error(
        "VRCHAT_TOTP_CODE or VRCHAT_TOTP_SECRET is required for TOTP-protected accounts.",
      );
    }

    const user = totpSecret
      ? await session.loginWithTotpSecret({
          username,
          password,
          totpSecret,
        })
      : await session.loginWithTotp({
          username,
          password,
          totpCode,
        });

    await writeCookieCache(session.exportCookies());
    console.log(`Logged in as ${user.displayName}`);
  } else {
    throw new Error(
      `Unsupported 2FA challenge: ${JSON.stringify(loginResult)}`,
    );
  }
}

const websocket = await session.connectWebsocket({
  bindNotificationHandlers: true,
});

const identity = await session.resolveIdentity();

console.log("Listening with session identity:", identity);

websocket.on("open", () => {
  console.log(
    `Connected to the VRChat websocket pipeline for ${websocket.label ?? session.authenticatedDisplayName ?? "unknown-account"}.`,
  );
});

websocket.on("message", (message) => {
  /** @type {import("../dist/index.js").VRChatWebsocketKnownMessage | import("../dist/index.js").VRChatWebsocketMessage} */
  const typedMessage = message;

  if (typedMessage.type === "user-location") {
    console.log(
      `Current user location update: ${typedMessage.content.location}`,
    );
  }

  console.log(`[${message.type}]`, message.content);
});

websocket.on("notification", (payload) => {
  console.log("Notification event:", payload);
});

websocket.on("notification-v2", (payload) => {
  console.log("Notification V2:", payload.title, payload.message);
});

websocket.on("group-member-updated", (payload) => {
  console.log("Group membership updated:", payload.member.groupId);
});

websocket.on("see-notification", (notificationId) => {
  console.log("Marked notification as read:", notificationId);
});

websocket.on("hide-notification", (notificationId) => {
  console.log("Hid notification:", notificationId);
});

websocket.on("reconnect", (attempt, delayMs) => {
  console.log(`Reconnecting in ${delayMs}ms (attempt ${attempt})`);
});

websocket.on("error", (error) => {
  console.error("Websocket error:", error);
});

await new Promise(() => {});
