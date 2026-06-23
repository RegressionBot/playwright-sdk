import { Page } from '@playwright/test';
import axios from 'axios';

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
    const response = await axios.post(`${activeApiUrl}/ci/job/init`, payload, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    activeJobId = response.data.jobId;
    if (activeJobId) {
      process.env.REGRESSIONBOT_JOB_ID = activeJobId;
    }
    return activeJobId!;
  } catch (err: any) {
    const errMsg = err.response?.data?.error || err.message;
    throw new Error(`Failed to initialize RegressionBot job: ${errMsg}`);
  }
}

/**
 * Captures a visual snapshot of the page, applies element masking,
 * requests a presigned upload URL, and uploads the screenshot directly to S3.
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

    // 4. Request S3 presigned PUT URL
    const uploadUrlEndpoint = `${activeApiUrl}/ci/job/upload-url`;
    const response = await axios.post(
      uploadUrlEndpoint,
      {
        jobId,
        url: page.url(),
        variantName,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const { uploadUrl } = response.data;
    if (!uploadUrl) {
      throw new Error('Upload endpoint failed to return presigned S3 URL.');
    }

    // 5. Perform direct S3 upload
    await axios.put(uploadUrl, buffer, {
      headers: {
        'Content-Type': 'image/png',
      },
    });
  } catch (err: any) {
    // Make sure styles are removed on error
    if (styleElementHandle) {
      await page.evaluate((el: any) => el?.remove(), styleElementHandle).catch(() => {});
    }
    const rawData = err.response?.data;
    let errMsg = `${err.message} (${err.config?.method?.toUpperCase()} ${err.config?.url})`;
    if (rawData) {
      let details = '';
      if (Buffer.isBuffer(rawData)) {
        details = rawData.toString('utf-8');
      } else if (typeof rawData === 'string') {
        details = rawData;
      } else if (rawData.error) {
        details = rawData.error;
      } else {
        details = JSON.stringify(rawData);
      }
      errMsg += ` - Details: ${details}`;
    }
    throw new Error(`RegressionBot visual capture failed: ${errMsg}`);
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
    await axios.post(
      `${activeApiUrl}/ci/job/finalize`,
      { jobId },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // Reset local state
    activeJobId = null;
    delete process.env.REGRESSIONBOT_JOB_ID;
  } catch (err: any) {
    const errMsg = err.response?.data?.error || err.message;
    throw new Error(`Failed to finalize RegressionBot job: ${errMsg}`);
  }
}

/**
 * Alias for captureVisual.
 */
export const captureScreenshot = captureVisual;

