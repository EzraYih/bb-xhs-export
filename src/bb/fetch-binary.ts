import { runBbBrowser, type BbBrowserOptions } from "./run-site.js";

export async function fetchBinaryToFile(url: string, outputPath: string, options: BbBrowserOptions = {}): Promise<void> {
  await runBbBrowser(["fetch", url, "--binary", "--output", outputPath], options);
}
