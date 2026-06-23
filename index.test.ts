describe('RegressionBot Playwright SDK', () => {
  let envBackup: NodeJS.ProcessEnv;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    envBackup = { ...process.env };
    originalFetch = global.fetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Clean env variables that influence default state
    delete process.env.REGRESSIONBOT_API_KEY;
    delete process.env.REGRESSIONBOT_API_URL;
    delete process.env.REGRESSIONBOT_JOB_ID;
    delete process.env.REGRESSIONBOT_PROJECT;
    delete process.env.REGRESSIONBOT_TEST_ORIGIN;
    delete process.env.REGRESSIONBOT_DEVICES;
    delete process.env.REGRESSIONBOT_BRANCH;
    delete process.env.REGRESSIONBOT_COMMIT;
  });

  afterAll(() => {
    process.env = envBackup;
    global.fetch = originalFetch;
  });

  // Helper to run each test in an isolated module context
  async function runIsolated(
    fn: (sdk: typeof import('./index')) => Promise<void>,
    beforeRequire?: () => void
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      jest.isolateModules(async () => {
        try {
          if (beforeRequire) {
            beforeRequire();
          }
          const sdk = require('./index');
          await fn(sdk);
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
      runIsolated(async (sdk) => {
        const mockFetch = jest.fn().mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ jobId: 'job-12345' }),
        });
        global.fetch = mockFetch;

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
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.regressionbot.com/ci/job/init',
          {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer api-key-abc',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              project: 'test-project',
              branch: 'feat-test',
              commit: 'sha-123',
              testOrigin: 'https://test.origin',
              devices: ['Desktop Chrome'],
            }),
          }
        );
      })
    );

    it('falls back to environment variables for API key and URL', () =>
      runIsolated(
        async (sdk) => {
          const mockFetch = jest.fn().mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ jobId: 'job-67890' }),
          });
          global.fetch = mockFetch;

          const jobId = await sdk.initializeJob({
            project: 'test-project',
            testOrigin: 'https://test.origin',
          });

          expect(jobId).toBe('job-67890');
          expect(mockFetch).toHaveBeenCalledWith(
            'https://custom.api.endpoint/ci/job/init',
            expect.objectContaining({
              method: 'POST',
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
        ).rejects.toThrow('RegressionBot: No active job found');
      })
    );

    it('captures full-page and uploads correctly without masking options', () =>
      runIsolated(async (sdk) => {
        process.env.REGRESSIONBOT_JOB_ID = 'job-12345';
        process.env.REGRESSIONBOT_API_KEY = 'api-key-abc';

        const mockFetch = jest.fn()
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ uploadUrl: 'https://cloud-storage.upload/job-12345/homepage.png' }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => 'OK',
          });
        global.fetch = mockFetch;

        await sdk.captureVisual(mockPage, 'homepage');

        expect(mockPage.screenshot).toHaveBeenCalledWith({
          fullPage: true,
          type: 'png',
          animations: 'disabled',
        });
        expect(mockPage.addStyleTag).not.toHaveBeenCalled();
        expect(mockFetch).toHaveBeenNthCalledWith(
          1,
          'https://api.regressionbot.com/ci/job/upload-url',
          {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer api-key-abc',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              jobId: 'job-12345',
              url: 'https://test.origin/home',
              variantName: 'homepage',
            }),
          }
        );
        expect(mockFetch).toHaveBeenNthCalledWith(
          2,
          'https://cloud-storage.upload/job-12345/homepage.png',
          {
            method: 'PUT',
            headers: { 'Content-Type': 'image/png' },
            body: expect.any(Buffer),
          }
        );
      })
    );

    it('applies and removes CSS masking style tags if mask is provided', () =>
      runIsolated(async (sdk) => {
        process.env.REGRESSIONBOT_JOB_ID = 'job-12345';
        process.env.REGRESSIONBOT_API_KEY = 'api-key-abc';

        const mockFetch = jest.fn()
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ uploadUrl: 'https://cloud-storage.upload/job-12345/homepage.png' }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => 'OK',
          });
        global.fetch = mockFetch;

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

    it('cleans up style tags even if screenshot or cloud upload fails', () =>
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
      runIsolated(async (sdk) => {
        process.env.REGRESSIONBOT_JOB_ID = 'job-12345';
        process.env.REGRESSIONBOT_API_KEY = 'api-key-abc';

        const mockFetch = jest.fn().mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
        global.fetch = mockFetch;

        await sdk.finalizeJob();

        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.regressionbot.com/ci/job/finalize',
          {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer api-key-abc',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ jobId: 'job-12345' }),
          }
        );
        expect(process.env.REGRESSIONBOT_JOB_ID).toBeUndefined();
      })
    );
  });

  describe('captureScreenshot alias', () => {
    it('is defined and aliases captureVisual', () =>
      runIsolated(async (sdk) => {
        expect(sdk.captureScreenshot).toBe(sdk.captureVisual);
      })
    );
  });

  describe('captureVisual error diagnostics', () => {
    it('throws a detailed error pointing to global-setup if no job exists', () =>
      runIsolated(async (sdk) => {
        const mockPage: any = {};
        await expect(sdk.captureVisual(mockPage, 'homepage')).rejects.toThrow(
          "RegressionBot: No active job found. Please ensure you have registered the globalSetup hook in playwright.config.ts:\n\n" +
            "  globalSetup: require.resolve('@regressionbot/playwright/global-setup')"
        );
      })
    );
  });

  describe('packaged global hooks', () => {
    it('globalSetup extracts configuration and calls initializeJob', async () => {
      return new Promise<void>((resolve, reject) => {
        jest.isolateModules(async () => {
          try {
            process.env.REGRESSIONBOT_PROJECT = 'env-project';
            process.env.REGRESSIONBOT_API_KEY = 'env-key';

            const mockFetch = jest.fn().mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({ jobId: 'job-global-setup-123' }),
            });
            global.fetch = mockFetch;

            const globalSetup = require('./global-setup').default;
            const mockConfig: any = {
              use: {
                baseURL: 'https://test-origin.example.com',
              },
              projects: [],
            };

            await globalSetup(mockConfig);

            expect(process.env.REGRESSIONBOT_JOB_ID).toBe('job-global-setup-123');
            expect(mockFetch).toHaveBeenCalledWith(
              'https://api.regressionbot.com/ci/job/init',
              expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                  project: 'env-project',
                  branch: 'main',
                  commit: '',
                  testOrigin: 'https://test-origin.example.com',
                  devices: ['Desktop Chrome'],
                }),
              })
            );
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    });

    it('globalSetup throws if project name is missing', async () => {
      return new Promise<void>((resolve, reject) => {
        jest.isolateModules(async () => {
          try {
            const globalSetup = require('./global-setup').default;
            const mockConfig: any = {
              use: {
                baseURL: 'https://test-origin.example.com',
              },
            };

            await expect(globalSetup(mockConfig)).rejects.toThrow(
              'REGRESSIONBOT_PROJECT environment variable is required'
            );
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    });

    it('globalTeardown calls finalizeJob', async () => {
      return new Promise<void>((resolve, reject) => {
        jest.isolateModules(async () => {
          try {
            process.env.REGRESSIONBOT_JOB_ID = 'job-global-setup-123';
            process.env.REGRESSIONBOT_API_KEY = 'env-key';

            const mockFetch = jest.fn().mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({}),
            });
            global.fetch = mockFetch;

            const globalTeardown = require('./global-teardown').default;
            await globalTeardown();

            expect(mockFetch).toHaveBeenCalledWith(
              'https://api.regressionbot.com/ci/job/finalize',
              {
                method: 'POST',
                headers: {
                  'Authorization': 'Bearer env-key',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ jobId: 'job-global-setup-123' }),
              }
            );
            expect(process.env.REGRESSIONBOT_JOB_ID).toBeUndefined();
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    });
  });
});
