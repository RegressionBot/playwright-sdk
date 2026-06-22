import axios from 'axios';

jest.mock('axios');

describe('RegressionBot Playwright SDK', () => {
  let envBackup: NodeJS.ProcessEnv;

  beforeAll(() => {
    envBackup = { ...process.env };
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Clean env variables that influence default state
    delete process.env.REGRESSIONBOT_API_KEY;
    delete process.env.REGRESSIONBOT_API_URL;
    delete process.env.REGRESSIONBOT_JOB_ID;
  });

  afterAll(() => {
    process.env = envBackup;
  });

  // Helper to run each test in an isolated module context
  async function runIsolated(
    fn: (
      sdk: typeof import('./index'),
      axiosMock: any
    ) => Promise<void>,
    beforeRequire?: () => void
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      jest.isolateModules(async () => {
        try {
          if (beforeRequire) {
            beforeRequire();
          }
          const sdk = require('./index');
          const axiosMock = require('axios');
          await fn(sdk, axiosMock);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  describe('initializeJob', () => {
    it('throws an error if apiKey is not provided in config or env', () =>
      runIsolated(async (sdk) => {
        await expect(
          sdk.initializeJob({
            project: 'test-project',
            testOrigin: 'https://test.origin',
          })
        ).rejects.toThrow('RegressionBot API Key is required');
      })
    );

    it('initializes job successfully and sets env variable', () =>
      runIsolated(async (sdk, axiosMock) => {
        axiosMock.post.mockResolvedValueOnce({
          data: { jobId: 'job-12345' },
        });

        const jobId = await sdk.initializeJob({
          apiKey: 'api-key-abc',
          project: 'test-project',
          testOrigin: 'https://test.origin',
          branch: 'feat-test',
          commit: 'sha-123',
          devices: ['Desktop Chrome'],
        });

        expect(jobId).toBe('job-12345');
        expect(process.env.REGRESSIONBOT_JOB_ID).toBe('job-12345');
        expect(axiosMock.post).toHaveBeenCalledWith(
          'https://api.regressionbot.com/sdk/job/init',
          {
            project: 'test-project',
            branch: 'feat-test',
            commit: 'sha-123',
            testOrigin: 'https://test.origin',
            devices: ['Desktop Chrome'],
          },
          {
            headers: {
              'Authorization': 'Bearer api-key-abc',
              'Content-Type': 'application/json',
            },
          }
        );
      })
    );

    it('falls back to environment variables for API key and URL', () =>
      runIsolated(
        async (sdk, axiosMock) => {
          axiosMock.post.mockResolvedValueOnce({
            data: { jobId: 'job-67890' },
          });

          const jobId = await sdk.initializeJob({
            project: 'test-project',
            testOrigin: 'https://test.origin',
          });

          expect(jobId).toBe('job-67890');
          expect(axiosMock.post).toHaveBeenCalledWith(
            'https://custom.api.endpoint/sdk/job/init',
            expect.any(Object),
            expect.objectContaining({
              headers: expect.objectContaining({
                'Authorization': 'Bearer env-api-key',
              }),
            })
          );
        },
        () => {
          process.env.REGRESSIONBOT_API_KEY = 'env-api-key';
          process.env.REGRESSIONBOT_API_URL = 'https://custom.api.endpoint';
        }
      )
    );
  });

  describe('captureVisual', () => {
    let mockPage: any;

    beforeEach(() => {
      mockPage = {
        url: jest.fn().mockReturnValue('https://test.origin/home'),
        screenshot: jest.fn().mockResolvedValue(Buffer.from('fake-png-data')),
        addStyleTag: jest.fn().mockResolvedValue({ id: 'style-tag' }),
        evaluate: jest.fn().mockResolvedValue(undefined),
      };
    });

    it('throws an error if no active job exists', () =>
      runIsolated(async (sdk) => {
        await expect(
          sdk.captureVisual(mockPage, 'homepage')
        ).rejects.toThrow('No active job found');
      })
    );

    it('captures full-page and uploads correctly without masking options', () =>
      runIsolated(async (sdk, axiosMock) => {
        process.env.REGRESSIONBOT_JOB_ID = 'job-12345';
        process.env.REGRESSIONBOT_API_KEY = 'api-key-abc';

        axiosMock.post.mockResolvedValueOnce({
          data: { uploadUrl: 'https://s3.upload/job-12345/homepage.png' },
        });
        axiosMock.put.mockResolvedValueOnce({ status: 200 } as any);

        await sdk.captureVisual(mockPage, 'homepage');

        expect(mockPage.screenshot).toHaveBeenCalledWith({
          fullPage: true,
          type: 'png',
          animations: 'disabled',
        });
        expect(mockPage.addStyleTag).not.toHaveBeenCalled();
        expect(axiosMock.post).toHaveBeenCalledWith(
          'https://api.regressionbot.com/sdk/job/upload-url',
          {
            jobId: 'job-12345',
            url: 'https://test.origin/home',
            variantName: 'homepage',
          },
          expect.any(Object)
        );
        expect(axiosMock.put).toHaveBeenCalledWith(
          'https://s3.upload/job-12345/homepage.png',
          expect.any(Buffer),
          { headers: { 'Content-Type': 'image/png' } }
        );
      })
    );

    it('applies and removes CSS masking style tags if mask is provided', () =>
      runIsolated(async (sdk, axiosMock) => {
        process.env.REGRESSIONBOT_JOB_ID = 'job-12345';
        process.env.REGRESSIONBOT_API_KEY = 'api-key-abc';

        axiosMock.post.mockResolvedValueOnce({
          data: { uploadUrl: 'https://s3.upload/job-12345/homepage.png' },
        });
        axiosMock.put.mockResolvedValueOnce({ status: 200 } as any);

        await sdk.captureVisual(mockPage, 'homepage', {
          mask: ['.ad-banner', '#chat-widget'],
        });

        expect(mockPage.addStyleTag).toHaveBeenCalledWith({
          content: '.ad-banner, #chat-widget { visibility: hidden !important; }',
        });
        expect(mockPage.evaluate).toHaveBeenCalledWith(
          expect.any(Function),
          { id: 'style-tag' }
        );
      })
    );

    it('cleans up style tags even if screenshot or S3 upload fails', () =>
      runIsolated(async (sdk) => {
        process.env.REGRESSIONBOT_JOB_ID = 'job-12345';
        process.env.REGRESSIONBOT_API_KEY = 'api-key-abc';

        mockPage.screenshot.mockRejectedValueOnce(new Error('Screenshot failed'));

        await expect(
          sdk.captureVisual(mockPage, 'homepage', { mask: ['.ad-banner'] })
        ).rejects.toThrow('Screenshot failed');

        expect(mockPage.evaluate).toHaveBeenCalledWith(
          expect.any(Function),
          { id: 'style-tag' }
        );
      })
    );
  });

  describe('finalizeJob', () => {
    it('throws error if no active job exists', () =>
      runIsolated(async (sdk) => {
        await expect(sdk.finalizeJob()).rejects.toThrow('No active job to finalize');
      })
    );

    it('finalizes job successfully and cleans up env state', () =>
      runIsolated(async (sdk, axiosMock) => {
        process.env.REGRESSIONBOT_JOB_ID = 'job-12345';
        process.env.REGRESSIONBOT_API_KEY = 'api-key-abc';

        axiosMock.post.mockResolvedValueOnce({ status: 200 } as any);

        await sdk.finalizeJob();

        expect(axiosMock.post).toHaveBeenCalledWith(
          'https://api.regressionbot.com/sdk/job/finalize',
          { jobId: 'job-12345' },
          expect.objectContaining({
            headers: expect.objectContaining({
              'Authorization': 'Bearer api-key-abc',
            }),
          })
        );
        expect(process.env.REGRESSIONBOT_JOB_ID).toBeUndefined();
      })
    );
  });
});
