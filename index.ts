import { Page } from '@playwright/test';

let activeJobId: string | null = null;
let activeApiKey: string | null = process.env.REGRESSIONBOT_API_KEY || null;
let activeApiUrl: string = process.env.REGRESSIONBOT_API_URL || 'https://api.regressionbot.com';
let activeProject: string | null = null;
let activeAwaitResults: boolean = true;
let activeAwaitTimeoutMs: number = 60000;

export interface SdkInitConfig {
  apiKey?: string;
  apiUrl?: string;
  project: string;
  branch?: string;
  commit?: string;
  testOrigin: string;
  devices?: string[];
  // New configuration options
  awaitResults?: boolean;    // Defaults to true
  awaitTimeoutMs?: number;   // Defaults to 60000 (60s)
}

/**
 * Shared helper for RegressionBot API JSON requests.
 */
async function apiRequest<T>(
  apiUrl: string,
  path: string,
  method: 'POST' | 'PUT' | 'GET',
  apiKey: string,
  body?: any
): Promise<T> {
  const url = `${apiUrl.replace(/\/$/, '')}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, {
    method,
    headers,
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
  activeProject = config.project;
  activeAwaitResults = config.awaitResults ?? true;
  activeAwaitTimeoutMs = config.awaitTimeoutMs ?? 60000;

  // Propagate to environment variables for globalTeardown context
  process.env.REGRESSIONBOT_AWAIT_RESULTS = activeAwaitResults ? 'true' : 'false';
  process.env.REGRESSIONBOT_AWAIT_TIMEOUT_MS = activeAwaitTimeoutMs.toString();

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

    const awaitResults = process.env.REGRESSIONBOT_AWAIT_RESULTS !== undefined
      ? process.env.REGRESSIONBOT_AWAIT_RESULTS === 'true'
      : activeAwaitResults;

    const awaitTimeoutMs = process.env.REGRESSIONBOT_AWAIT_TIMEOUT_MS !== undefined
      ? parseInt(process.env.REGRESSIONBOT_AWAIT_TIMEOUT_MS, 10)
      : activeAwaitTimeoutMs;

    if (awaitResults) {
      console.log(`[RegressionBot] Waiting for visual comparison and RegressionBot summary to complete (timeout: ${awaitTimeoutMs / 1000}s)...`);
      const startTime = Date.now();
      const intervalMs = 2000;
      let jobStatus: any = null;

      while (Date.now() - startTime < awaitTimeoutMs) {
        try {
          const data = await apiRequest<{
            status: string;
            summaryStatus?: string;
            error?: string;
          }>(
            activeApiUrl,
            `/job/${encodeURIComponent(jobId)}`,
            'GET',
            apiKey
          );

          const status = data.status;
          const summaryStatus = data.summaryStatus;

          const isDone =
            status === 'FAILED' ||
            ((status === 'COMPLETED' || status === 'APPROVED') &&
              summaryStatus !== 'PENDING' &&
              summaryStatus !== 'PROCESSING');

          if (isDone) {
            jobStatus = data;
            break;
          }
        } catch (err: any) {
          // Log polling error and keep trying unless timed out
          console.warn(`[RegressionBot] Polling status failed: ${err.message}. Retrying...`);
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }

      if (!jobStatus) {
        throw new Error(
          `RegressionBot visual check timed out after ${awaitTimeoutMs / 1000}s.`
        );
      }

      if (jobStatus.status === 'FAILED') {
        throw new Error(
          `RegressionBot job failed during screenshot capture or processing.`
        );
      }

      const summary = await apiRequest<{
        status: string;
        overallScore: number;
        totalUrls: number;
        regressionCount: number;
        regressions?: Array<{
          url: string;
          variantName: string;
          visualMatchScore: number;
          diffUrl?: string;
          regressionbotSummary?: Array<{ label: string; text: string }>;
        }>;
      }>(
        activeApiUrl,
        `/job/${encodeURIComponent(jobId)}/summary`,
        'GET',
        apiKey
      );

      // Print visual summary directly to terminal logs
      console.log('\n==================================================');
      console.log('                 REGRESSIONBOT SUMMARY             ');
      console.log('==================================================');
      console.log(`Status:           ${summary.status}`);
      console.log(`Overall Score:    ${summary.overallScore}/100`);
      console.log(`Page Count:       ${summary.totalUrls}`);
      console.log(`Regression Count: ${summary.regressionCount}`);

      if (summary.regressionCount > 0 && summary.regressions && summary.regressions.length > 0) {
        console.log('\n❌ Regressions found:');
        for (const r of summary.regressions) {
          console.log(`- ${r.url} [${r.variantName}] (Score: ${r.visualMatchScore.toFixed(2)})`);
          if (r.diffUrl) {
            console.log(`  Diff: ${r.diffUrl}`);
          }
          if (Array.isArray(r.regressionbotSummary) && r.regressionbotSummary.length > 0) {
            console.log('  Summary:');
            for (const item of r.regressionbotSummary) {
              console.log(`    - ${item.label}: ${item.text}`);
            }
          } else if (r.regressionbotSummary) {
            console.log(`  Summary: ${r.regressionbotSummary}`);
          }
        }
      }
      console.log('==================================================\n');

      if (summary.regressionCount > 0) {
        throw new Error(
          `RegressionBot visual check failed: ${summary.regressionCount} regression${summary.regressionCount === 1 ? '' : 's'} detected.`
        );
      }
    }
  } catch (err: any) {
    throw new Error(`Failed to finalize RegressionBot job: ${err.message}`);
  } finally {
    // Reset local state
    activeJobId = null;
    activeProject = null;
    activeAwaitResults = true;
    activeAwaitTimeoutMs = 60000;
    delete process.env.REGRESSIONBOT_JOB_ID;
  }
}

/**
 * Alias for captureVisual.
 */
export const captureScreenshot = captureVisual;
