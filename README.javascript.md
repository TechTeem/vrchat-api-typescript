# vrchat-api-typescript for JavaScript

JavaScript usage is fully supported. This package ships runtime builds for both ESM and CommonJS, plus TypeScript definitions for editors that can consume them.

## Source of truth

This package is generated from the VRChat API specification published by the `vrchatapi/specification` project:

- Spec repository: https://github.com/vrchatapi/specification
- Bundled artifact: https://github.com/vrchatapi/specification/releases/latest/download/openapi.json

Important: this API documentation is community-driven and is not officially supported by VRChat. Endpoint behavior may change without notice.

## Install

```bash
npm install vrchat-api-typescript
```

## Module formats

ESM:

```js
import { VRChatApiClient, VRChatSessionClient } from "vrchat-api-typescript";
```

CommonJS:

```js
const {
  VRChatApiClient,
  VRChatSessionClient,
} = require("vrchat-api-typescript");
```

## Usage

```js
import { VRChatApiClient, VRCHAT_SPEC_VERSION } from "vrchat-api-typescript";

const client = new VRChatApiClient({
  baseUrl: "https://api.vrchat.cloud/api/1",
});

console.log(VRCHAT_SPEC_VERSION);
```

The generated package exports endpoint methods, request/response types, and model interfaces derived from the OpenAPI document.

## Common API examples

Most VRChat API calls require an authenticated session. In the examples below, make sure the client or session is already authenticated either by logging in first or by restoring cookies from a previous session.

For low-level SDK usage, call `VRChatApiClient` methods directly:

```js
import { VRChatApiClient } from "vrchat-api-typescript";

const client = new VRChatApiClient({
  baseUrl: "https://api.vrchat.cloud/api/1",
});

// Ensure this client is authenticated first, either via login flow or restored cookies.

const configResult = await client.getConfig({
  responseStyle: "fields",
  throwOnError: true,
});

console.log(configResult.data.clientApiKey);
```

If you want typed data plus access to the raw response, keep using `responseStyle: "fields"`:

```js
import { VRChatApiClient } from "vrchat-api-typescript";

const client = new VRChatApiClient();

// Ensure this client is authenticated first, either via login flow or restored cookies.

const worldResult = await client.getWorld({
  path: { worldId: "wrld_00000000-0000-0000-0000-000000000000" },
  responseStyle: "fields",
  throwOnError: false,
});

if (worldResult.error) {
  console.error(worldResult.response.status, worldResult.error);
} else {
  console.log(worldResult.data.name);
  console.log(worldResult.data.authorName);
}
```

For authenticated API usage, call generated endpoints through `session.api`:

```js
import { VRChatSessionClient } from "vrchat-api-typescript";

const session = new VRChatSessionClient();

// Ensure this session is authenticated first, either via login flow or restored cookies.

const worlds = await session.api.searchWorlds({
  query: {
    search: "chill",
    n: 10,
    featured: true,
  },
  responseStyle: "fields",
  throwOnError: true,
});

for (const world of worlds.data) {
  console.log(`${world.name} by ${world.authorName}`);
}
```

You can use the same pattern for direct lookups by ID:

```js
import { VRChatSessionClient } from "vrchat-api-typescript";

const session = new VRChatSessionClient();

// Ensure this session is authenticated first, either via login flow or restored cookies.

const user = await session.api.getUser({
  path: { userId: "usr_00000000-0000-0000-0000-000000000000" },
  responseStyle: "fields",
  throwOnError: true,
});

console.log(user.data.displayName);
```

## Session helper

The package also includes a handwritten session wrapper for login, cookie persistence, and 2FA completion.

If you restore cookies before calling `login()`, `loginWithTotp()`, or `loginWithTotpSecret()`, the session client now tries the existing auth cookie first and only falls back to username/password login when that cookie is missing or no longer valid.

VRChat expects a descriptive `User-Agent`. The session client now sends one by default, but for production usage you should set your own app-specific value.

```js
import {
  VRChatSessionClient,
  isCurrentUser,
  isTwoFactorChallenge,
} from "vrchat-api-typescript";

const session = new VRChatSessionClient();
const login = await session.login({
  username: process.env.VRCHAT_USERNAME,
  password: process.env.VRCHAT_PASSWORD,
  userAgent: "my-vrchat-tool/1.0.0 (+mailto:you@example.com)",
});

if (isCurrentUser(login)) {
  console.log(`Logged in as ${login.displayName}`);
}

if (
  isTwoFactorChallenge(login) &&
  login.requiresTwoFactorAuth.includes("totp")
) {
  await session.verify2Fa(process.env.VRCHAT_TOTP_CODE);
}

const cookies = session.exportCookies();
const cookieHeader = session.getCookieHeader();

await session.getCurrentUser();
await session.logout();
```

Use `exportCookies()` or `getCookieHeader()` to persist the session between restarts and later restore it with `restoreFromCookies()` or `restoreFromCookieHeader()`.

If you want to persist a session to a specific file and restore it later:

```js
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { VRChatSessionClient } from "vrchat-api-typescript";

const sessionFilePath = resolve("./data/vrchat-session.json");
const session = new VRChatSessionClient();

if (existsSync(sessionFilePath)) {
  const savedCookies = JSON.parse(readFileSync(sessionFilePath, "utf8"));
  session.restoreFromCookies(savedCookies);
}

const login = await session.login({
  username: process.env.VRCHAT_USERNAME,
  password: process.env.VRCHAT_PASSWORD,
  userAgent: "my-vrchat-tool/1.0.0 (+mailto:you@example.com)",
});

writeFileSync(
  sessionFilePath,
  JSON.stringify(session.exportCookies(), null, 2),
  "utf8",
);

console.log(login);
```

If you prefer to store the raw cookie header instead of the cookie object:

```js
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { VRChatSessionClient } from "vrchat-api-typescript";

const cookieHeaderPath = resolve("./data/vrchat-cookie-header.txt");
const session = new VRChatSessionClient();

if (existsSync(cookieHeaderPath)) {
  session.restoreFromCookieHeader(readFileSync(cookieHeaderPath, "utf8"));
}

// Ensure the session is authenticated before using it.

writeFileSync(cookieHeaderPath, session.getCookieHeader(), "utf8");
```

## Websocket pipeline

The package now exposes the VRChat pipeline websocket for notifications and other realtime events.

You can use the standalone websocket client directly if you already have an `auth` cookie value:

```js
import { VRChatWebsocketClient } from "vrchat-api-typescript";

const websocket = new VRChatWebsocketClient({
  authToken: process.env.VRCHAT_AUTH_COOKIE,
  autoReconnect: true,
});

websocket.on("notification", (payload) => {
  console.log("notification", payload);
});

websocket.on("message", (message) => {
  console.log(message.type, message.content);
});

await websocket.connect();
```

If you are already using `VRChatSessionClient`, reuse the same login session and auth cookie:

```js
import { VRChatSessionClient } from "vrchat-api-typescript";

const session = new VRChatSessionClient({
  label: "main-account",
  metadata: { shard: "alpha" },
});

await session.loginWithTotp({
  username: process.env.VRCHAT_USERNAME,
  password: process.env.VRCHAT_PASSWORD,
  totpCode: process.env.VRCHAT_TOTP_CODE,
});

const websocket = await session.connectWebsocket({
  bindNotificationHandlers: true,
});
const identity = await session.resolveIdentity();

console.log(identity.id, identity.displayName, identity.label);
console.log(websocket.label, websocket.metadata);

websocket.on("notification", (payload) => {
  console.log("notification", payload);
});

websocket.on("message", (message) => {
  console.log(message.type, message.content);
});
```

For multi-account apps, each `VRChatSessionClient` keeps its own cached authenticated user and websocket instance. Use `session.currentIdentity`, `await session.resolveIdentity()`, `session.authenticatedUserId`, `session.authenticatedDisplayName`, plus optional `label` and `metadata` to tell instances apart without maintaining a separate lookup table.

If you want the SDK to automatically react to websocket notification directives, call `session.connectWebsocket({ bindNotificationHandlers: true })` or `session.bindWebsocketNotificationHandlers()`. That will translate `see-notification`, `hide-notification`, and `clear-notification` websocket messages into the matching REST calls.

Every incoming pipeline packet is emitted twice:

- `message`: receives `{ type, content, rawContent, receivedAt }`
- `<type>`: the packet's `type` string is emitted as an event name with the parsed content payload

That means you can subscribe to specific event types such as `notification`, while still keeping a catch-all listener for anything else the pipeline sends.

The library also includes typed event names for TypeScript users covering the common documented pipeline events, including notification, notification-v2, friend, user, and group updates.

For accounts that always use TOTP, you can collapse login and verification into one call:

```js
import { VRChatSessionClient } from "vrchat-api-typescript";

const session = new VRChatSessionClient();
const user = await session.loginWithTotp({
  username: process.env.VRCHAT_USERNAME,
  password: process.env.VRCHAT_PASSWORD,
  totpCode: process.env.VRCHAT_TOTP_CODE,
  userAgent: "my-vrchat-tool/1.0.0 (+mailto:you@example.com)",
});

console.log(user.displayName);
```

If you store the base32 TOTP secret instead of the current 6-digit code, you can generate the OTP dynamically:

```js
import { VRChatSessionClient } from "vrchat-api-typescript";

const session = new VRChatSessionClient();
const user = await session.loginWithTotpSecret({
  username: process.env.VRCHAT_USERNAME,
  password: process.env.VRCHAT_PASSWORD,
  totpSecret: process.env.VRCHAT_TOTP_SECRET,
  userAgent: "my-vrchat-tool/1.0.0 (+mailto:you@example.com)",
});

console.log(user.displayName);
```

You can also generate a code yourself and pass it wherever needed:

```js
import { generateTotpCode } from "vrchat-api-typescript";

const code = generateTotpCode(process.env.VRCHAT_TOTP_SECRET);
```

## Session runtime behavior

`VRChatSessionClient` keeps auth state and rate-limit state per instance. If you create multiple clients for multiple VRChat accounts, their cookies, login cooldowns, and endpoint cooldowns do not affect each other.

Non-login API calls are guarded locally. If the session has no valid auth state yet, calls such as `session.api.getGroup()` are rejected immediately with `401` instead of sending a request to VRChat. Login-related calls are still allowed:

- `login()`
- `loginWithTotp()`
- `loginWithTotpSecret()`
- `verify2Fa()`
- `verify2FaEmailCode()`
- `verifyRecoveryCode()`

If an `auth` cookie has already been restored into the session, those login helpers reuse that cookie-backed session first. A new credential-based login is only attempted after the stored cookie is confirmed invalid.

Login-related requests handle `429` automatically. When VRChat responds with `Retry-After`, the client waits for that duration plus a small safety buffer and then retries the login flow for that instance.

Other API methods use per-method cooldowns. If `session.api.getGroup()` receives `429`, the client records that cooldown for `getGroup()` on that session instance. Additional `getGroup()` calls during the cooldown return a local `429` immediately, while unrelated methods can still run.

If you want the raw generated-client style result instead of exceptions, call methods with `throwOnError: false`:

```js
const result = await session.api.getGroup({
  groupId: "grp_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  throwOnError: false,
});

if (result.error) {
  console.log(result.response.status);
  console.log(result.error);
}
```

When a local or remote rate limit is active, the error payload includes retry information when available:

- `error.retry_after`
- `error.retry_after_ms`

## Example script

Run the local example after setting the required environment variables:

```bash
export VRCHAT_USERNAME="your-username"
export VRCHAT_PASSWORD="your-password"
export VRCHAT_TOTP_CODE="123456"
export VRCHAT_TOTP_SECRET="BASE32SECRET"
npm run example:session
```

The example stores cookies in `.vrchat-session.json` so repeated runs can reuse the same session. If both `VRCHAT_TOTP_CODE` and `VRCHAT_TOTP_SECRET` are set, the secret-based flow is used.
