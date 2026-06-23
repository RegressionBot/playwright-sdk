# @regressionbot/playwright

The official Playwright package for **[RegressionBot.com](https://regressionbot.com)** — the simplest way to automate visual regression testing.

RegressionBot is a declarative visual regression testing platform that helps you catch UI changes before they reach production. This Playwright package integrates directly into your E2E test suite to upload page snapshots and run visual comparisons automatically.

[![RegressionBot Docs](https://img.shields.io/badge/docs-regressionbot.com-4be277?style=for-the-badge&labelColor=0b0f14)](https://regressionbot.com/docs)

---

## Why RegressionBot?

Unlike traditional visual diffing libraries, RegressionBot is designed for modern, automated development loops and agentic pipelines:

- **Highly Accurate Regressions (Zero Noise)**: Leveraging advanced pixel-matching algorithms and element masking (using CSS selectors), RegressionBot eliminates false positives caused by dynamic data, layout shifting, or third-party widgets.
- **Plain-English Summaries**: No more manual screenshot comparisons. RegressionBot translates visual diffs into concise, plain-English descriptions of what changed, so you know exactly what was modified at a glance.
- **Agentic Workflow Ready**: Built from the ground up to support autonomous coding agents and automated developer loops. Through standard API endpoints, CLI commands, and integrations, agents can trigger tests, read plain-English results, and approve baseline changes programmatically without human intervention.

---

## Key Features

* 🚀 **Offload Comparison Overhead:** Captures and uploads screenshots directly from Playwright execution and delegates heavy-lifting pixel matching to the RegressionBot parallel cloud engine.
* 👁️ **Visual Element Masking:** Mask dynamic components (e.g., ad banners, live timers, user avatars) before capture to prevent false positives.
* 🤖 **AI-Powered Diff Summaries:** Generates natural, plain-English explanations of exactly what changed (e.g., text reflows, styling changes, button movement) instead of raw pixel maps.
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

# Optional: Override the API endpoint (defaults to https://api.regressionbot.com)
export REGRESSIONBOT_API_URL="https://api.regressionbot.com"
```

### 2. Update Playwright Config (`playwright.config.ts`)
You can register the pre-packaged setup and teardown hooks directly in your config file. Playwright will run them automatically to initialize and finalize the visual regression job on the RegressionBot servers.

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Register pre-packaged global hooks from the SDK
  globalSetup: require.resolve('@regressionbot/playwright/global-setup'),
  globalTeardown: require.resolve('@regressionbot/playwright/global-teardown'),
  use: {
    baseURL: 'http://localhost:3000',
    // Set your project name here (or use REGRESSIONBOT_PROJECT environment variable)
    regressionbotProject: 'my-frontend-app',
  },
});
```

> [!NOTE]
> If you already have custom `globalSetup` and `globalTeardown` scripts in your codebase, you can import and call `initializeJob()` and `finalizeJob()` within your existing scripts. See the [Custom Setup / Teardown Integration](#custom-setup--teardown-integration) section below.

### 3. Capture Visuals in your Spec files
Call `captureScreenshot` (or `captureVisual`) inside your test cases to queue screenshot capturing.

```typescript
import { test } from '@playwright/test';
import { captureScreenshot } from '@regressionbot/playwright';

test('Homepage visual verification', async ({ page }) => {
  await page.goto('/');
  
  // Captures full-page view, uploads it to cloud storage, and compares it to the project baseline
  await captureScreenshot(page, 'homepage_desktop');
});

test('Dashboard with dynamic widgets', async ({ page }) => {
  await page.goto('/dashboard');
  
  // Hide live graphs or user info that changes on every render
  await captureScreenshot(page, 'dashboard_metrics', {
    mask: ['.dynamic-charts', '.user-welcome-message', 'time.live-clock']
  });
});
```

---

## Environment Configuration

When using the pre-packaged `global-setup` hook, it will automatically extract settings from the following environment variables:

| Environment Variable | Description | Playwright Config Fallback | Default |
| :--- | :--- | :--- | :--- |
| `REGRESSIONBOT_PROJECT` | The project name in the RegressionBot dashboard. | `use.regressionbotProject` or `metadata.regressionbotProject` | *Required* |
| `REGRESSIONBOT_TEST_ORIGIN` | The base URL where the tests are running. | `use.baseURL` or `projects[0].use.baseURL` | *Required* |
| `REGRESSIONBOT_API_KEY` | Your project's API authentication key. | - | *Required* |
| `REGRESSIONBOT_API_URL` | Override the cloud API endpoint (e.g. for private instances). | - | `https://api.regressionbot.com` |
| `REGRESSIONBOT_BRANCH` | Git branch name. | `CI_COMMIT_REF_NAME` | `'main'` |
| `REGRESSIONBOT_COMMIT` | Git commit hash. | `CI_COMMIT_SHA` | `''` |
| `REGRESSIONBOT_DEVICES` | Comma-separated list of devices (e.g. `Desktop Chrome,iPhone 13`). | - | `['Desktop Chrome']` |

---

## Custom Setup / Teardown Integration

If you have existing custom global setup/teardown files configured, you can integrate RegressionBot in one of two ways:

### Approach 1: Composing with Pre-packaged Hooks (Recommended)
You can import and execute our pre-packaged `global-setup` and `global-teardown` default functions inside your existing files. This utilizes our built-in configuration and environment parser without any boilerplate.

**In your custom `global-setup.ts`:**
```typescript
import { FullConfig } from '@playwright/test';
import regressionbotSetup from '@regressionbot/playwright/global-setup';

async function globalSetup(config: FullConfig) {
  // Your other custom setup steps...

  // Delegate initialization to the pre-packaged setup hook
  await regressionbotSetup(config);
}

export default globalSetup;
```

**In your custom `global-teardown.ts`:**
```typescript
import regressionbotTeardown from '@regressionbot/playwright/global-teardown';

async function globalTeardown() {
  // Your other custom teardown steps...

  // Delegate finalization to the pre-packaged teardown hook
  await regressionbotTeardown();
}

export default globalTeardown;
```

### Approach 2: Direct API Calls (Manual Configuration)
If you want fine-grained control or want to construct the initialization parameters dynamically in code, you can invoke `initializeJob` and `finalizeJob` manually.

**In your custom `global-setup.ts`:**
```typescript
import { FullConfig } from '@playwright/test';
import { initializeJob } from '@regressionbot/playwright';

async function globalSetup(config: FullConfig) {
  // Your other custom setup steps...
  
  await initializeJob({
    project: 'my-frontend-app',
    testOrigin: config.use.baseURL || 'http://localhost:3000',
    apiKey: process.env.REGRESSIONBOT_API_KEY,
  });
}

export default globalSetup;
```

**In your custom `global-teardown.ts`:**
```typescript
import { finalizeJob } from '@regressionbot/playwright';

async function globalTeardown() {
  // Your other custom teardown steps...

  await finalizeJob();
}

export default globalTeardown;
```

---

## API Reference

### `initializeJob(config: SdkInitConfig): Promise<string>`
Initiates a new visual regression job on the RegressionBot cloud server. Typically placed inside Playwright's `globalSetup`.

Calling `initializeJob` automatically exposes the generated job ID to Playwright's worker processes via `process.env.REGRESSIONBOT_JOB_ID`.

**Config Options:**
* `project` (string, required): The RegressionBot project name.
* `testOrigin` (string, required): The target origin URL being verified.
* `apiKey` (string, optional): Your API key. Defaults to `process.env.REGRESSIONBOT_API_KEY`.
* `apiUrl` (string, optional): RegressionBot API endpoint. Defaults to `process.env.REGRESSIONBOT_API_URL`, falling back to `https://api.regressionbot.com`.
* `branch` (string, optional): Git branch name. Defaults to `process.env.CI_COMMIT_REF_NAME`, falling back to `'main'`.
* `commit` (string, optional): Git commit SHA. Defaults to `process.env.CI_COMMIT_SHA`, falling back to `''`.
* `devices` (string[], optional): Viewports/devices to configure. Defaults to `['Desktop Chrome']`.

### `captureScreenshot(page: Page, variantName: string, options?: { mask?: string[] }): Promise<void>`
Alias for `captureVisual`. Takes a full-page screenshot of the page (`fullPage: true`, `animations: 'disabled'`), hides dynamic element CSS selectors listed in `mask`, and uploads the screenshot directly to cloud storage.
* `page` (Page): The Playwright test page instance.
* `variantName` (string): Unique label for the snapshot (e.g. `homepage_hero`, `checkout_final`).
* `options.mask` (string[]): List of CSS selectors to hide (`visibility: hidden !important`) during screenshot capture. If provided, the stylesheet is automatically injected and cleaned up post-capture.

### `captureVisual(page: Page, variantName: string, options?: { mask?: string[] }): Promise<void>`
Alternative name for `captureScreenshot`. Captures and uploads a full-page screenshot with optional CSS masking.

### `finalizeJob(): Promise<void>`
Completes the current visual regression session and instructs RegressionBot to execute parallel comparisons in the cloud. Typically called in Playwright's `globalTeardown`.

---

## License

This project is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
