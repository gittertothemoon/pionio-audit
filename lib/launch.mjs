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
    // args orientati a container con poca RAM: spengono GPU/estensioni/audio e il
    // lavoro in background di Chrome → meno memoria e meno rumore di misura.
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--mute-audio",
      "--no-first-run",
      "--hide-scrollbars",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
  });
}
