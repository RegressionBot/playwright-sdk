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

  await initializeJob({
    project,
    testOrigin,
    apiKey,
    apiUrl,
    branch,
    commit,
    devices,
  });
}

export default globalSetup;
