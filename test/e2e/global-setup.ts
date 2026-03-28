export default async function globalSetup(): Promise<void> {
  // Dev mode now uses an in-browser in-memory API; each test page starts from seeded state.
  // Keep the hook for parity with Playwright config, but avoid disk mutation.
}
