import { Page } from '@playwright/test';
import { gzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);

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
  runContext?: any;
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

  const payload: any = {
    project: config.project,
    branch: config.branch || process.env.CI_COMMIT_REF_NAME || 'main',
    commit: config.commit || process.env.CI_COMMIT_SHA || '',
    testOrigin: config.testOrigin.replace(/\/$/, ''),
    devices: config.devices || ['Desktop Chrome'],
  };

  if (config.runContext) {
    payload.runContext = config.runContext;
  }

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

  let domSnapshot: string | null = null;
  try {
    // 2. Extract DOM snapshot using the browser serialization logic
    try {
      const rawDom = await page.evaluate(() => {
        const whitelist = [
          'color', 'background-color', 'font-size', 'font-weight', 
          'font-style', 'font-family', 'display', 'position', 
          'opacity', 'visibility', 'width', 'height'
        ];
        
        function serializeNode(el: Element): any {
          if (el.nodeType !== Node.ELEMENT_NODE) {
            return null;
          }
          
          // Skip collapsed/invisible nodes immediately
          const offsetW = (el as HTMLElement).offsetWidth;
          const offsetH = (el as HTMLElement).offsetHeight;
          if (offsetW === 0 && offsetH === 0) {
            return null;
          }
          
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            return null;
          }
          
          const node: any = {
            tagName: el.tagName,
            rect: {
              x: Math.round(rect.left + window.scrollX),
              y: Math.round(rect.top + window.scrollY),
              w: Math.round(rect.width),
              h: Math.round(rect.height)
            }
          };
          
          if (el.id) node.id = el.id;
          if (el.className && typeof el.className === 'string') {
            node.className = el.className.trim();
          }
          
          // Look for direct text content
          let hasDirectText = false;
          let directText = '';
          for (let i = 0; i < el.childNodes.length; i++) {
            const child = el.childNodes[i];
            if (child.nodeType === Node.TEXT_NODE) {
              const textVal = child.nodeValue?.trim() || '';
              if (textVal.length > 0) {
                hasDirectText = true;
                directText += (directText ? ' ' : '') + textVal;
              }
            }
          }
          
          const tagName = el.tagName.toUpperCase();
          const isLeafOrVisual = hasDirectText || 
            ['IMG', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A', 'SVG'].includes(tagName);
          
          if (isLeafOrVisual) {
            const computed = window.getComputedStyle(el);
            if (computed.display === 'none' || computed.visibility === 'hidden' || computed.opacity === '0') {
              return null;
            }
            
            const styles: Record<string, string> = {};
            whitelist.forEach(prop => {
              const val = computed.getPropertyValue(prop);
              if (val && 
                  !(prop === 'opacity' && val === '1') && 
                  !(prop === 'visibility' && val === 'visible') && 
                  !(prop === 'display' && val === 'block') &&
                  !(prop === 'position' && val === 'static')) {
                styles[prop] = val;
              }
            });
            
            if (Object.keys(styles).length > 0) {
              node.styles = styles;
            }
            
            if (hasDirectText) {
              node.text = directText.slice(0, 100);
            }
          }
          
          const children: any[] = [];
          for (let i = 0; i < el.children.length; i++) {
            const childNode = serializeNode(el.children[i]);
            if (childNode) {
              children.push(childNode);
            }
          }
          
          if (children.length > 0) {
            node.children = children;
          } else if (!isLeafOrVisual) {
            return null;
          }
          
          return node;
        }
        
        return serializeNode(document.body);
      });
      domSnapshot = JSON.stringify(rawDom);
    } catch (domErr: any) {
      console.warn(`[RegressionBot] Failed to serialize DOM: ${domErr.message}`);
    }

    // 3. Take local full-page screenshot
    const buffer = await page.screenshot({
      fullPage: true,
      type: 'png',
      animations: 'disabled',
    });

    // 4. Clean up the style tags immediately
    if (styleElementHandle) {
      await page.evaluate((el: any) => el?.remove(), styleElementHandle);
      styleElementHandle = null;
    }

    // 5. Request presigned upload URL
    const data = await apiRequest<{ uploadUrl: string; domUploadUrl?: string }>(
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

    const { uploadUrl, domUploadUrl } = data;
    if (!uploadUrl) {
      throw new Error('Upload endpoint failed to return presigned upload URL.');
    }

    // 6. Perform direct cloud storage upload of screenshot
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

    // 7. Perform direct cloud storage upload of DOM snapshot if domUploadUrl is available
    if (domSnapshot && domUploadUrl && process.env.SKIP_DOM_UPLOAD !== 'true') {
      try {
        const compressedDom = await gzipAsync(domSnapshot);
        const domUploadResponse = await fetch(domUploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Content-Encoding': 'gzip',
          },
          body: compressedDom as any,
        });

        if (!domUploadResponse.ok) {
          const errorText = await domUploadResponse.text();
          console.warn(`[RegressionBot] DOM snapshot upload failed: ${domUploadResponse.statusText} - ${errorText}`);
        }
      } catch (domErr: any) {
        console.warn(`[RegressionBot] Failed to compress or upload DOM snapshot: ${domErr.message}`);
      }
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
