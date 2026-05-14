/**
 * Local dev mode helpers.
 *
 * When LOCAL_DEV_MODE=true, bypass Azure credentials and use
 * dummy/mock values where possible so the app starts without az login.
 */

export function isLocalDev(): boolean {
  return process.env.LOCAL_DEV_MODE === "true";
}

export function mockBearerToken(): string {
  return "dev-mock-token-" + Date.now();
}

export function mockProjectEndpoint(): string {
  return process.env.AZURE_AI_PROJECT_ENDPOINT ?? "http://localhost:9999";
}

export function warnIfLocalDev() {
  if (isLocalDev()) {
    console.warn(
      "[local-dev] LOCAL_DEV_MODE is enabled. Azure credentials are mocked. " +
        "Foundry calls will fail unless you run a local mock server."
    );
  }
}
