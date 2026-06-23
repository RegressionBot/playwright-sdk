import { Page } from '@playwright/test';

let activeJobId: string | null = null;
let activeApiKey: string | null = process.env.REGRESSIONBOT_API_KEY || null;
let activeApiUrl: string = process.env.REGRESSIONBOT_API_URL || 'https://api.regressionbot.com';

export interface SdkInitConfig {
  apiKey?: string;
  apiUrl?: string;
  project: string;
  branch?: string;
  commit?: string;
  testOrigin: string;
  devices?: string[];
}

/**
 * Shared helper for RegressionBot API JSON requests.
 */
async function apiRequest<T>(
  apiUrl: string,
  path: string,
  method: 'POST' | 'PUT',
  apiKey: string,
  body?: any
): Promise<T> {
  const url = `${apiUrl.replace(/\/$/, '')}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorJson;
    try {
      errorJson = JSON.parse(errorText);
    } catch {}
    const errMsg = errorJson?.error || errorText || response.statusText;
    throw new Error(errMsg);
  }

  if (method === 'PUT') {
    return {} as T;
  }

  return (await response.json()) as T;
}

/**
 * Initializes a visual regression job for the test suite run.
 * Typically called in Playwright's globalSetup hook.
 */
export async function initializeJob(config: SdkInitConfig): Promise<string> {
  const apiKey = config.apiKey || activeApiKey;
  const apiUrl = config.apiUrl || activeApiUrl;

  if (!apiKey) {
    throw new Error(
      'RegressionBot API Key is required. Set REGRESSIONBOT_API_KEY env var or pass in config.'
    );
  }

  // Sync state
  activeApiKey = apiKey;
  activeApiUrl = apiUrl.replace(/\/$/, '');

  const payload = {
    project: config.project,
    branch: config.branch || process.env.CI_COMMIT_REF_NAME || 'main',
    commit: config.commit || process.env.CI_COMMIT_SHA || '',
    testOrigin: config.testOrigin.replace(/\/$/, ''),
    devices: config.devices || ['Desktop Chrome'],
  };

  try {
    const data = await apiRequest<{ jobId: string }>(
      activeApiUrl,
      '/ci/job/init',
      'POST',
      apiKey,
      payload
    );

    activeJobId = data.jobId;
    if (activeJobId) {
      process.env.REGRESSIONBOT_JOB_ID = activeJobId;
    }
    return activeJobId!;
  } catch (err: any) {
    throw new Error(`Failed to initialize RegressionBot job: ${err.message}`);
  }
}

/**
 * Captures a visual snapshot of the page, applies element masking,
 * requests a presigned upload URL, and uploads the screenshot directly to cloud storage.
 */
export async function captureVisual(
  page: Page,
  variantName: string,
  options: { mask?: string[] } = {}
): Promise<void> {
  const jobId = activeJobId || process.env.REGRESSIONBOT_JOB_ID;
  const apiKey = activeApiKey || process.env.REGRESSIONBOT_API_KEY;

  if (!jobId) {
    throw new Error(
      'RegressionBot: No active job found. Please ensure you have registered the globalSetup hook in playwright.config.ts:\n\n' +
        "  globalSetup: require.resolve('@regressionbot/playwright/global-setup')\n"
    );
  }
  if (!apiKey) {
    throw new Error('API Key is missing. Set REGRESSIONBOT_API_KEY env var.');
  }

  // 1. Inject CSS stylesheet rules to mask dynamic elements
  let styleElementHandle: any = null;
  if (options.mask && options.mask.length > 0) {
    const cssRules = `${options.mask.join(', ')} { visibility: hidden !important; }`;
    styleElementHandle = await page.addStyleTag({ content: cssRules });
  }

  try {
    // 2. Take local full-page screenshot
    const buffer = await page.screenshot({
      fullPage: true,
      type: 'png',
      animations: 'disabled',
    });

    // 3. Clean up the style tags immediately
    if (styleElementHandle) {
      await page.evaluate((el: any) => el?.remove(), styleElementHandle);
      styleElementHandle = null;
    }

    // 4. Request presigned upload URL
    const data = await apiRequest<{ uploadUrl: string }>(
      activeApiUrl,
      '/ci/job/upload-url',
      'POST',
      apiKey,
      {
        jobId,
        url: page.url(),
        variantName,
      }
    );

    const { uploadUrl } = data;
    if (!uploadUrl) {
      throw new Error('Upload endpoint failed to return presigned upload URL.');
    }

    // 5. Perform direct cloud storage upload
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/png',
      },
      body: buffer as any,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Cloud storage upload failed: ${uploadResponse.statusText} - ${errorText}`);
    }
  } catch (err: any) {
    // Make sure styles are removed on error
    if (styleElementHandle) {
      await page.evaluate((el: any) => el?.remove(), styleElementHandle).catch(() => {});
    }
    throw new Error(`RegressionBot visual capture failed: ${err.message}`);
  }
}

/**
 * Finalizes the visual regression job and triggers parallel image diff comparison in the cloud.
 * Typically called in Playwright's globalTeardown hook.
 */
export async function finalizeJob(): Promise<void> {
  const jobId = activeJobId || process.env.REGRESSIONBOT_JOB_ID;
  const apiKey = activeApiKey || process.env.REGRESSIONBOT_API_KEY;

  if (!jobId) {
    throw new Error('No active job to finalize.');
  }
  if (!apiKey) {
    throw new Error('API Key is missing. Set REGRESSIONBOT_API_KEY env var.');
  }

  try {
    await apiRequest(
      activeApiUrl,
      '/ci/job/finalize',
      'POST',
      apiKey,
      { jobId }
    );

    // Reset local state
    activeJobId = null;
    delete process.env.REGRESSIONBOT_JOB_ID;
  } catch (err: any) {
    throw new Error(`Failed to finalize RegressionBot job: ${err.message}`);
  }
}

/**
 * Alias for captureVisual.
 */
export const captureScreenshot = captureVisual;
