# vrchat-api-typescript

TypeScript SDK and type definitions for the VRChat Web API, generated from the community-maintained VRChat OpenAPI specification.

## Source of truth

This package is generated from the VRChat API specification published by the `vrchatapi/specification` project:

- Spec repository: https://github.com/vrchatapi/specification
- Bundled artifact: https://github.com/vrchatapi/specification/releases/latest/download/openapi.json

Important: this API documentation is community-driven and is not officially supported by VRChat. Endpoint behavior may change without notice.

## Install

```bash
npm install vrchat-api-typescript
```

## Regenerate from upstream

```bash
npm install
npm run generate
npm run build
```

`npm run generate` downloads the latest bundled `openapi.json` release artifact from the upstream specification repository and regenerates the SDK.

## Usage

```ts
import { VRChatApiClient, VRCHAT_SPEC_VERSION } from "vrchat-api-typescript";

const client = new VRChatApiClient({
  baseUrl: "https://api.vrchat.cloud/api/1",
});

console.log(VRCHAT_SPEC_VERSION);
```

The generated package exports endpoint methods, request/response types, and model interfaces derived from the OpenAPI document.

## Session helper

The package also includes a handwritten session wrapper for login, cookie persistence, and 2FA completion.

VRChat expects a descriptive `User-Agent`. The session client now sends one by default, but for production usage you should set your own app-specific value.

```ts
import {
  VRChatSessionClient,
  isCurrentUser,
  isTwoFactorChallenge,
} from "vrchat-api-typescript";

const session = new VRChatSessionClient();
const login = await session.login({
  username: process.env.VRCHAT_USERNAME!,
  password: process.env.VRCHAT_PASSWORD!,
  userAgent: "my-vrchat-tool/1.0.0 (+mailto:you@example.com)",
});

if (isCurrentUser(login)) {
  console.log(`Logged in as ${login.displayName}`);
}

if (
  isTwoFactorChallenge(login) &&
  login.requiresTwoFactorAuth.includes("totp")
) {
  await session.verify2Fa(process.env.VRCHAT_TOTP_CODE!);
}

const cookies = session.exportCookies();
const cookieHeader = session.getCookieHeader();

await session.getCurrentUser();
await session.logout();
```

Use `exportCookies()` or `getCookieHeader()` to persist the session between restarts and later restore it with `restoreFromCookies()` or `restoreFromCookieHeader()`.

For accounts that always use TOTP, you can collapse login and verification into one call:

```ts
import { VRChatSessionClient } from "vrchat-api-typescript";

const session = new VRChatSessionClient();
const user = await session.loginWithTotp({
  username: process.env.VRCHAT_USERNAME!,
  password: process.env.VRCHAT_PASSWORD!,
  totpCode: process.env.VRCHAT_TOTP_CODE!,
  userAgent: "my-vrchat-tool/1.0.0 (+mailto:you@example.com)",
});

console.log(user.displayName);
```

If you store the base32 TOTP secret instead of the current 6-digit code, you can generate the OTP dynamically:

```ts
import { VRChatSessionClient } from "vrchat-api-typescript";

const session = new VRChatSessionClient();
const user = await session.loginWithTotpSecret({
  username: process.env.VRCHAT_USERNAME!,
  password: process.env.VRCHAT_PASSWORD!,
  totpSecret: process.env.VRCHAT_TOTP_SECRET!,
  userAgent: "my-vrchat-tool/1.0.0 (+mailto:you@example.com)",
});

console.log(user.displayName);
```

You can also generate a code yourself and pass it wherever needed:

```ts
import { generateTotpCode } from "vrchat-api-typescript";

const code = generateTotpCode(process.env.VRCHAT_TOTP_SECRET!);
```

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
