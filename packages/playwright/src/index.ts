/**
 * @aether/playwright — Browser automation via Playwright
 *
 * Provides a simple wrapper around Playwright for browser automation.
 * Uses a try-require pattern for playwright-core so the package
 * works gracefully even if playwright-core is not installed.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const VERSION = '0.1.0';
/** Browser types that may be launched or auto-installed. */
export const BROWSER_NAMES = ['chromium', 'firefox', 'webkit'] as const;

/** Type guard for supported browser names (durable contract, also used at runtime). */
export function isSupportedBrowser(name: string): name is (typeof BROWSER_NAMES)[number] {
  return (BROWSER_NAMES as readonly string[]).includes(name);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LaunchOptions {
  /** Browser type: "chromium" (default), "firefox", or "webkit" */
  browser?: 'chromium' | 'firefox' | 'webkit';
  /** Whether to run in headless mode (default: true) */
  headless?: boolean;
  /** Additional browser launch args */
  args?: string[];
  /** Proxy server settings */
  proxy?: { server: string };
  /** Timeout in ms for browser launch (default: 30_000) */
  timeout?: number;
  /** Whether to download browser binaries if missing (default: false) */
  install?: boolean;
}

export interface PageOptions {
  /** Viewport width (default: 1280) */
  width?: number;
  /** Viewport height (default: 720) */
  height?: number;
}

export interface ScreenshotOptions {
  /** Full page screenshot (default: false) */
  fullPage?: boolean;
  /** Image type (default: "png") */
  type?: 'png' | 'jpeg';
  /** Quality (1-100, only for jpeg) */
  quality?: number;
}

// ---------------------------------------------------------------------------
// Module-level state (lazy dynamic import)
// ---------------------------------------------------------------------------

type PlaywrightModule = typeof import('playwright-core');
let _pw: PlaywrightModule | null = null;
let _pwError: Error | null = null;

async function getPlaywright(): Promise<PlaywrightModule> {
  if (_pw) return _pw;
  if (_pwError) throw _pwError;

  try {
    // Dynamic import works in both CJS and ESM
    _pw = (await import('playwright-core')) as unknown as PlaywrightModule;
    return _pw;
  } catch (err) {
    _pwError = new Error(
      'playwright-core is not installed. Run: npm install playwright-core\n' +
        'Or if you need browsers: npx playwright install chromium',
    );
    throw _pwError;
  }
}

// ---------------------------------------------------------------------------
// Browser management helpers
// ---------------------------------------------------------------------------

/**
 * Try to install browser binaries if not found.
 * Returns true if successful or already installed, false otherwise.
 */
async function ensureBrowserInstalled(
  browserName: 'chromium' | 'firefox' | 'webkit',
): Promise<boolean> {
  const pw = await getPlaywright();
  try {
    const browserType = pw[browserName];
    const executablePath = browserType.executablePath();
    if (existsSync(executablePath)) {
      return true;
    }
  } catch {
    // Will try to install
  }

  try {
    // The name is interpolated into a shell command; only ever allow-listed
    // identifiers may reach it, so an attacker-supplied value cannot run
    // arbitrary commands on the host.
    if (!isSupportedBrowser(browserName)) return false;
    execSync(`npx playwright install ${browserName}`, {
      stdio: 'pipe',
      timeout: 120_000,
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Launch a browser instance.
 * Defaults to Chromium in headless mode.
 * Returns a browser object that can be used to create pages.
 */
export async function launchBrowser(
  options: LaunchOptions = {},
): Promise<import('playwright-core').Browser> {
  const pw = await getPlaywright();
  const browserType = options.browser ?? 'chromium';
  const headless = options.headless ?? true;

  if (options.install) {
    await ensureBrowserInstalled(browserType);
  }

  const browser = await pw[browserType].launch({
    headless,
    args: options.args,
    proxy: options.proxy,
    timeout: options.timeout ?? 30_000,
  });

  return browser;
}

/**
 * Create a new page in the browser.
 * Optionally navigates to a URL.
 */
export async function createPage(
  browser: import('playwright-core').Browser,
  url?: string,
  options: PageOptions = {},
): Promise<import('playwright-core').Page> {
  const context = await browser.newContext({
    viewport: {
      width: options.width ?? 1280,
      height: options.height ?? 720,
    },
  });

  const page = await context.newPage();

  if (url) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  return page;
}

/**
 * Navigate the page to a URL.
 */
export async function navigate(
  page: import('playwright-core').Page,
  url: string,
  options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' },
): Promise<void> {
  await page.goto(url, {
    waitUntil: options?.waitUntil ?? 'domcontentloaded',
  });
}

/**
 * Take a screenshot of the page.
 * If no path is provided, returns the screenshot as a Buffer.
 */
export async function screenshot(
  page: import('playwright-core').Page,
  filePath?: string,
  options: ScreenshotOptions = {},
): Promise<Buffer | void> {
  const opts: Record<string, unknown> = {};
  if (options.fullPage) opts.fullPage = true;
  if (options.type) opts.type = options.type;
  if (options.quality !== undefined) opts.quality = options.quality;

  if (filePath) {
    await page.screenshot({ path: filePath, ...opts });
    return;
  }

  return page.screenshot(opts) as Promise<Buffer>;
}

/**
 * Get the full HTML content of the page.
 */
export async function getContent(page: import('playwright-core').Page): Promise<string> {
  return page.content();
}

/**
 * Execute JavaScript in the page context.
 */
export async function evaluate<T = unknown>(
  page: import('playwright-core').Page,
  fn: string | (() => T),
): Promise<T> {
  return page.evaluate(fn as any) as Promise<T>;
}

/**
 * Click an element on the page.
 */
export async function click(page: import('playwright-core').Page, selector: string): Promise<void> {
  await page.click(selector);
}

/**
 * Type text into an element on the page.
 */
export async function type(
  page: import('playwright-core').Page,
  selector: string,
  text: string,
  options?: { delay?: number },
): Promise<void> {
  // If delay is specified, use type for human-like typing
  if (options?.delay) {
    await page.type(selector, text, { delay: options.delay });
  } else {
    await page.fill(selector, text);
  }
}

/**
 * Get the page title.
 */
export async function getPageTitle(page: import('playwright-core').Page): Promise<string> {
  return page.title();
}

/**
 * Close a browser instance and all its pages/contexts.
 */
export async function closeBrowser(browser: import('playwright-core').Browser): Promise<void> {
  await browser.close();
}
