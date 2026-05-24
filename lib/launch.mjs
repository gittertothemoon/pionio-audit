// Lancio Chrome unico per CLI e server.
// In locale usa il Chrome di sistema (channel "chrome", perché playwright-core
// non scarica browser). In Docker (immagine Playwright) PW_CHANNEL="" → usa il
// Chromium bundled dell'immagine. Gli args servono per girare in container.
import { chromium } from "playwright-core";

export function launchBrowser() {
  const channel = process.env.PW_CHANNEL ?? "chrome";
  return chromium.launch({
    ...(channel ? { channel } : {}),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}
