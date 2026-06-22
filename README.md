# @regressionbot/playwright

The official Playwright integration client for **[RegressionBot](https://regressionbot.com)** — the commercial SaaS cloud-based visual regression testing platform. 

RegressionBot crawls your pages, captures high-resolution screenshots across multiple device viewports, performs pixel-level structural comparisons (SSIM) in the cloud, and utilizes AWS Bedrock to generate plain-English explanations of visual layout changes.

[![RegressionBot Docs](https://img.shields.io/badge/docs-regressionbot.com-blueviolet?style=for-the-badge)](https://regressionbot.com/docs)

---

## Key Features

* 🚀 **Offload Comparison Overhead:** Captures and uploads screenshots directly from Playwright execution and delegates heavy-lifting pixel matching (SSIM) to the RegressionBot parallel cloud engine.
* 👁️ **Visual Element Masking:** Mask dynamic components (e.g., ad banners, live timers, user avatars) before capture to prevent false positives.
* 🤖 **AI-Powered Diff Summaries:** Generates AWS Bedrock-powered plain-English explanations of exactly what changed (e.g., text reflows, styling changes, button movement) instead of raw pixel maps.
* 📱 **Multi-Viewport & Responsive:** Run snapshots under multiple device variants simultaneously.

---

## Installation

Install the package via npm:

```bash
npm install --save-dev @regressionbot/playwright
```

Ensure you have `@playwright/test` installed as a dependency/peer-dependency.

---

## Quick Start

### 1. Configure Environment Variables
You need a RegressionBot API key to initialize jobs. Get yours from the [Dashboard](https://regressionbot.com/admin).

```bash
export REGRESSIONBOT_API_KEY="your_regressionbot_api_key"
```

### 2. Update Playwright Config (`playwright.config.ts`)
Set up global initialization and finalization hooks in your global setup/teardown scripts:

```typescript
import { FullConfig } from '@playwright/test';
import { initializeJob, finalizeJob } from '@regressionbot/playwright';

async function globalSetup(config: FullConfig) {
  await initializeJob({
    project: 'my-frontend-app',
    testOrigin: 'http://localhost:3000', // The base URL where tests are running locally/CI
    devices: ['Desktop Chrome', 'iPhone 13'],
  });
}

async function globalTeardown(config: FullConfig) {
  await finalizeJob();
}

export default {
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),
  use: {
    baseURL: 'http://localhost:3000',
  },
};
```

### 3. Capture Visuals in your Spec files
Call `captureVisual` inside your test cases to queue screenshot capturing.

```typescript
import { test } from '@playwright/test';
import { captureVisual } from '@regressionbot/playwright';

test('Homepage visual verification', async ({ page }) => {
  await page.goto('/');
  
  // Captures full-page view, uploads it to S3, and compares it to the project baseline
  await captureVisual(page, 'homepage_desktop');
});

test('Dashboard with dynamic widgets', async ({ page }) => {
  await page.goto('/dashboard');
  
  // Hide live graphs or user info that changes on every render
  await captureVisual(page, 'dashboard_metrics', {
    mask: ['.dynamic-charts', '.user-welcome-message', 'time.live-clock']
  });
});
```

---

## API Reference

### `initializeJob(config: SdkInitConfig): Promise<string>`
Initiates a new visual regression job. Typically placed inside Playwright's `globalSetup`.

**Config Options:**
* `project` (string, required): The RegressionBot project name.
* `testOrigin` (string, required): The target origin URL being verified.
* `apiKey` (string, optional): Your API key. Defaults to `process.env.REGRESSIONBOT_API_KEY`.
* `apiUrl` (string, optional): RegressionBot API endpoint. Defaults to `https://api.regressionbot.com`.
* `branch` (string, optional): Git branch name. Auto-detects CI branch envs if omitted.
* `commit` (string, optional): Git commit SHA. Auto-detects CI commit envs if omitted.
* `devices` (string[], optional): Viewports/devices to configure. Defaults to `['Desktop Chrome']`.

### `captureVisual(page: Page, variantName: string, options?: { mask?: string[] }): Promise<void>`
Captures a screenshot of the page, hides dynamic element CSS selectors listed in `mask`, and uploads it to S3.
* `page` (Page): The Playwright test page instance.
* `variantName` (string): Unique label for the snapshot (e.g. `homepage_hero`, `checkout_final`).
* `options.mask` (string[]): List of CSS selectors to hide (`visibility: hidden !important`) during screenshot capture.

### `finalizeJob(): Promise<void>`
Completes the current visual regression session and instructs RegressionBot to execute parallel comparisons. Typically called in Playwright's `globalTeardown`.

---

## License

This project is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
