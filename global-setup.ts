import { FullConfig } from '@playwright/test';
import { initializeJob } from './index';

async function globalSetup(config: FullConfig) {
  // 1. Read regressionbot project name
  // First check env, then check config.use.regressionbotProject, then config.metadata.regressionbotProject
  const project =
    process.env.REGRESSIONBOT_PROJECT ||
    (config as any).use?.regressionbotProject ||
    (config as any).metadata?.regressionbotProject;

  if (!project) {
    throw new Error(
      'RegressionBot: REGRESSIONBOT_PROJECT environment variable is required to initialize the job. ' +
        'Please set it in your environment/dotenv file or configure "regressionbotProject" in playwright.config.ts.'
    );
  }

  // 2. Read test origin
  // First check env, then fall back to config.projects[0]?.use?.baseURL or config.use?.baseURL
  const testOrigin =
    process.env.REGRESSIONBOT_TEST_ORIGIN ||
    config.projects?.[0]?.use?.baseURL ||
    (config as any).use?.baseURL ||
    '';

  if (!testOrigin) {
    throw new Error(
      'RegressionBot: Could not determine testOrigin. Please set the REGRESSIONBOT_TEST_ORIGIN environment variable ' +
        'or configure baseURL in playwright.config.ts.'
    );
  }

  // 3. Read other config inputs from environment variables
  const apiKey = process.env.REGRESSIONBOT_API_KEY;
  const apiUrl = process.env.REGRESSIONBOT_API_URL;
  const branch = process.env.REGRESSIONBOT_BRANCH || process.env.CI_COMMIT_REF_NAME;
  const commit = process.env.REGRESSIONBOT_COMMIT || process.env.CI_COMMIT_SHA;
  const devices = process.env.REGRESSIONBOT_DEVICES?.split(',').map((d) => d.trim()) || undefined;

  // New configuration options
  let awaitResults: boolean = true;
  if (process.env.REGRESSIONBOT_AWAIT_RESULTS !== undefined) {
    awaitResults = process.env.REGRESSIONBOT_AWAIT_RESULTS === 'true';
  } else if ((config as any).use?.regressionbotAwaitResults !== undefined) {
    awaitResults = (config as any).use.regressionbotAwaitResults;
  } else if ((config as any).metadata?.regressionbotAwaitResults !== undefined) {
    awaitResults = (config as any).metadata.regressionbotAwaitResults;
  }

  const awaitTimeoutMs =
    process.env.REGRESSIONBOT_AWAIT_TIMEOUT_MS
      ? parseInt(process.env.REGRESSIONBOT_AWAIT_TIMEOUT_MS, 10)
      : (config as any).use?.regressionbotAwaitTimeoutMs ||
        (config as any).metadata?.regressionbotAwaitTimeoutMs ||
        undefined;

  let runContext: any = undefined;
  if (process.env.REGRESSIONBOT_RUN_CONTEXT) {
    try {
      runContext = JSON.parse(process.env.REGRESSIONBOT_RUN_CONTEXT);
    } catch {
      runContext = { changeDescription: process.env.REGRESSIONBOT_RUN_CONTEXT };
    }
  } else if ((config as any).use?.regressionbotRunContext !== undefined) {
    runContext = (config as any).use.regressionbotRunContext;
  } else if ((config as any).metadata?.regressionbotRunContext !== undefined) {
    runContext = (config as any).metadata.regressionbotRunContext;
  }

  await initializeJob({
    project,
    testOrigin,
    apiKey,
    apiUrl,
    branch,
    commit,
    devices,
    awaitResults,
    awaitTimeoutMs,
    runContext,
  });
}

export default globalSetup;
