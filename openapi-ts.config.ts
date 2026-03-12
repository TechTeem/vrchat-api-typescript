import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./openapi.json",
  output: "src/generated",
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: true,
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: true,
    },
    {
      name: "@hey-api/transformers",
      exportFromIndex: true,
    },
    {
      name: "@hey-api/sdk",
      exportFromIndex: true,
      auth: false,
      asClass: true,
      instance: true,
      transformer: true,
      classNameBuilder: () => "VRChatApiClient",
    },
  ],
});
