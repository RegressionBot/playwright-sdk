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

    it('propagates runContext if provided', () =>
      runIsolated(async (sdk) => {
        const mockFetch = jest.fn().mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ jobId: 'job-12345' }),
        });
        global.fetch = mockFetch;

        await sdk.initializeJob({
          apiKey: 'api-key-abc',
          project: 'test-project',
          testOrigin: 'https://test.origin',
          runContext: { ref: 'refs/heads/main', author: 'chris' },
        });

        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.regressionbot.com/ci/job/init',
          expect.objectContaining({
            body: JSON.stringify({
              project: 'test-project',
              branch: 'main',
              commit: '',
              testOrigin: 'https://test.origin',
              devices: ['Desktop Chrome'],
              runContext: { ref: 'refs/heads/main', author: 'chris' },
            }),
          })
        );
      })
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

    it('extracts DOM snapshot, compresses it and uploads if domUploadUrl is provided', () =>
      runIsolated(async (sdk) => {
        process.env.REGRESSIONBOT_JOB_ID = 'job-12345';
        process.env.REGRESSIONBOT_API_KEY = 'api-key-abc';

        const mockDom = { tagName: 'BODY', children: [{ tagName: 'DIV', text: 'Hello' }] };
        mockPage.evaluate = jest.fn().mockResolvedValue(mockDom);

        const mockFetch = jest.fn()
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
              uploadUrl: 'https://cloud-storage.upload/job-12345/homepage.png',
              domUploadUrl: 'https://cloud-storage.upload/job-12345/homepage.dom.json.gz',
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => 'OK',
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => 'OK',
          });
        global.fetch = mockFetch;

        await sdk.captureVisual(mockPage, 'homepage');

        expect(mockPage.evaluate).toHaveBeenCalled();
        // First fetch: get upload URLs
        expect(mockFetch).toHaveBeenNthCalledWith(
          1,
          'https://api.regressionbot.com/ci/job/upload-url',
          expect.any(Object)
        );
        // Second fetch: upload PNG
        expect(mockFetch).toHaveBeenNthCalledWith(
          2,
          'https://cloud-storage.upload/job-12345/homepage.png',
          expect.any(Object)
        );
        // Third fetch: upload zipped DOM JSON
        expect(mockFetch).toHaveBeenNthCalledWith(
          3,
          'https://cloud-storage.upload/job-12345/homepage.dom.json.gz',
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Content-Encoding': 'gzip',
            },
            body: expect.any(Buffer),
          }
        );
      })
    );

    it('does not upload DOM snapshot if SKIP_DOM_UPLOAD is true', () =>
      runIsolated(async (sdk) => {
        process.env.REGRESSIONBOT_JOB_ID = 'job-12345';
        process.env.REGRESSIONBOT_API_KEY = 'api-key-abc';
        process.env.SKIP_DOM_UPLOAD = 'true';

        const mockDom = { tagName: 'BODY', children: [{ tagName: 'DIV', text: 'Hello' }] };
        mockPage.evaluate = jest.fn().mockResolvedValue(mockDom);

        const mockFetch = jest.fn()
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
              uploadUrl: 'https://cloud-storage.upload/job-12345/homepage.png',
              domUploadUrl: 'https://cloud-storage.upload/job-12345/homepage.dom.json.gz',
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => 'OK',
          });
        global.fetch = mockFetch;

        await sdk.captureVisual(mockPage, 'homepage');

        expect(mockFetch).toHaveBeenCalledTimes(2); // Only URLs req + PNG upload
        delete process.env.SKIP_DOM_UPLOAD;
      })
    );
  });

  describe('finalizeJob', () => {
    it('throws error if no active job exists', () =>
      runIsolated(async (sdk) => {
        await expect(sdk.finalizeJob()).rejects.toThrow('No active job to finalize');
      })
    );

    it('finalizes job successfully and cleans up env state (non-blocking)', () =>
      runIsolated(async (sdk) => {
        // Initialize with awaitResults: false to test non-blocking mode
        const mockInitFetch = jest.fn().mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ jobId: 'job-12345' }),
        });
        global.fetch = mockInitFetch;
        await sdk.initializeJob({
          project: 'test-project',
          testOrigin: 'https://test.origin',
          awaitResults: false,
          apiKey: 'api-key-abc',
        });

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

    it('polls and completes successfully when awaitResults is true', () =>
      runIsolated(async (sdk) => {
        const mockInitFetch = jest.fn().mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ jobId: 'job-12345' }),
        });
        global.fetch = mockInitFetch;
        await sdk.initializeJob({
          project: 'test-project',
          testOrigin: 'https://test.origin',
          awaitResults: true,
          awaitTimeoutMs: 5000,
          apiKey: 'api-key-abc',
        });

        const mockFetch = jest.fn()
          // 1. Finalize
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({}),
          })
          // 2. Poll Status (first call is PROCESSING)
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ status: 'PROCESSING', summaryStatus: 'PENDING' }),
          })
          // 3. Poll Status (second call is COMPLETED + COMPLETE)
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ status: 'COMPLETED', summaryStatus: 'COMPLETE' }),
          })
          // 4. Get Summary
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
              status: 'COMPLETED',
              overallScore: 98.5,
              totalUrls: 5,
              regressionCount: 0,
              regressions: [],
            }),
          });
        global.fetch = mockFetch;

        await sdk.finalizeJob();

        expect(mockFetch).toHaveBeenNthCalledWith(
          1,
          'https://api.regressionbot.com/ci/job/finalize',
          expect.objectContaining({ method: 'POST' })
        );
        expect(mockFetch).toHaveBeenNthCalledWith(
          2,
          'https://api.regressionbot.com/job/job-12345',
          expect.objectContaining({ method: 'GET' })
        );
        expect(mockFetch).toHaveBeenNthCalledWith(
          3,
          'https://api.regressionbot.com/job/job-12345',
          expect.objectContaining({ method: 'GET' })
        );
        expect(mockFetch).toHaveBeenNthCalledWith(
          4,
          'https://api.regressionbot.com/job/job-12345/summary',
          expect.objectContaining({ method: 'GET' })
        );
        expect(process.env.REGRESSIONBOT_JOB_ID).toBeUndefined();
      })
    );

    it('throws error when regressions are detected', () =>
      runIsolated(async (sdk) => {
        const mockInitFetch = jest.fn().mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ jobId: 'job-12345' }),
        });
        global.fetch = mockInitFetch;
        await sdk.initializeJob({
          project: 'test-project',
          testOrigin: 'https://test.origin',
          awaitResults: true,
          awaitTimeoutMs: 5000,
          apiKey: 'api-key-abc',
        });

        const mockFetch = jest.fn()
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({}),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ status: 'COMPLETED', summaryStatus: 'COMPLETE' }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
              status: 'COMPLETED',
              overallScore: 92.0,
              totalUrls: 5,
              regressionCount: 2,
              regressions: [
                {
                  url: 'https://test.origin/home',
                  variantName: 'Desktop Chrome',
                  visualMatchScore: 90.0,
                  diffUrl: 'https://diff-url/home.png',
                  regressionbotSummary: [{ label: 'Footer', text: 'Color changed from red to green' }]
                }
              ],
            }),
          });
        global.fetch = mockFetch;

        await expect(sdk.finalizeJob()).rejects.toThrow(
          'RegressionBot visual check failed: 2 regressions detected.'
        );
        expect(process.env.REGRESSIONBOT_JOB_ID).toBeUndefined();
      })
    );

    it('throws error when polling times out', () =>
      runIsolated(async (sdk) => {
        const mockInitFetch = jest.fn().mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ jobId: 'job-12345' }),
        });
        global.fetch = mockInitFetch;
        await sdk.initializeJob({
          project: 'test-project',
          testOrigin: 'https://test.origin',
          awaitResults: true,
          awaitTimeoutMs: 100,
          apiKey: 'api-key-abc',
        });

        const mockFetch = jest.fn()
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({}),
          })
          .mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ status: 'PROCESSING', summaryStatus: 'PENDING' }),
          });
        global.fetch = mockFetch;

        await expect(sdk.finalizeJob()).rejects.toThrow(
          /RegressionBot visual check timed out/
        );
        expect(process.env.REGRESSIONBOT_JOB_ID).toBeUndefined();
      })
    );

    it('throws error when job status is FAILED', () =>
      runIsolated(async (sdk) => {
        const mockInitFetch = jest.fn().mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ jobId: 'job-12345' }),
        });
        global.fetch = mockInitFetch;
        await sdk.initializeJob({
          project: 'test-project',
          testOrigin: 'https://test.origin',
          awaitResults: true,
          awaitTimeoutMs: 5000,
          apiKey: 'api-key-abc',
        });

        const mockFetch = jest.fn()
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({}),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ status: 'FAILED', summaryStatus: 'COMPLETE' }),
          });
        global.fetch = mockFetch;

        await expect(sdk.finalizeJob()).rejects.toThrow(
          'RegressionBot job failed during screenshot capture or processing.'
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

    it('globalSetup extracts await options from config and environment variables', async () => {
      return new Promise<void>((resolve, reject) => {
        jest.isolateModules(async () => {
          try {
            process.env.REGRESSIONBOT_PROJECT = 'env-project';
            process.env.REGRESSIONBOT_API_KEY = 'env-key';
            process.env.REGRESSIONBOT_AWAIT_RESULTS = 'false';
            process.env.REGRESSIONBOT_AWAIT_TIMEOUT_MS = '30000';

            const mockFetch = jest.fn().mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({ jobId: 'job-global-setup-123' }),
            });
            global.fetch = mockFetch;

            const globalSetup = require('./global-setup').default;
            const sdk = require('./index');
            const mockConfig: any = {
              use: {
                baseURL: 'https://test-origin.example.com',
              },
            };

            await globalSetup(mockConfig);

            const mockFinalizeFetch = jest.fn().mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({}),
            });
            global.fetch = mockFinalizeFetch;

            await sdk.finalizeJob();

            expect(mockFinalizeFetch).toHaveBeenCalledTimes(1);

            delete process.env.REGRESSIONBOT_AWAIT_RESULTS;
            delete process.env.REGRESSIONBOT_AWAIT_TIMEOUT_MS;
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    });

    it('globalSetup extracts runContext from env (JSON format)', async () => {
      return new Promise<void>((resolve, reject) => {
        jest.isolateModules(async () => {
          try {
            process.env.REGRESSIONBOT_PROJECT = 'env-project';
            process.env.REGRESSIONBOT_API_KEY = 'env-key';
            process.env.REGRESSIONBOT_RUN_CONTEXT = '{"pr":123,"repo":"my-repo"}';

            const mockFetch = jest.fn().mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({ jobId: 'job-123' }),
            });
            global.fetch = mockFetch;

            const globalSetup = require('./global-setup').default;
            const mockConfig: any = {
              use: {
                baseURL: 'https://test-origin.example.com',
              },
            };

            await globalSetup(mockConfig);

            expect(mockFetch).toHaveBeenCalledWith(
              'https://api.regressionbot.com/ci/job/init',
              expect.objectContaining({
                body: JSON.stringify({
                  project: 'env-project',
                  branch: 'main',
                  commit: '',
                  testOrigin: 'https://test-origin.example.com',
                  devices: ['Desktop Chrome'],
                  runContext: { pr: 123, repo: 'my-repo' },
                }),
              })
            );

            delete process.env.REGRESSIONBOT_RUN_CONTEXT;
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    });

    it('globalSetup extracts runContext from env (fallback text format)', async () => {
      return new Promise<void>((resolve, reject) => {
        jest.isolateModules(async () => {
          try {
            process.env.REGRESSIONBOT_PROJECT = 'env-project';
            process.env.REGRESSIONBOT_API_KEY = 'env-key';
            process.env.REGRESSIONBOT_RUN_CONTEXT = 'PR #123 Build';

            const mockFetch = jest.fn().mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({ jobId: 'job-123' }),
            });
            global.fetch = mockFetch;

            const globalSetup = require('./global-setup').default;
            const mockConfig: any = {
              use: {
                baseURL: 'https://test-origin.example.com',
              },
            };

            await globalSetup(mockConfig);

            expect(mockFetch).toHaveBeenCalledWith(
              'https://api.regressionbot.com/ci/job/init',
              expect.objectContaining({
                body: JSON.stringify({
                  project: 'env-project',
                  branch: 'main',
                  commit: '',
                  testOrigin: 'https://test-origin.example.com',
                  devices: ['Desktop Chrome'],
                  runContext: { changeDescription: 'PR #123 Build' },
                }),
              })
            );

            delete process.env.REGRESSIONBOT_RUN_CONTEXT;
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    });

    it('globalSetup extracts runContext from Playwright config (use & metadata)', async () => {
      return new Promise<void>((resolve, reject) => {
        jest.isolateModules(async () => {
          try {
            process.env.REGRESSIONBOT_PROJECT = 'env-project';
            process.env.REGRESSIONBOT_API_KEY = 'env-key';

            const mockFetch = jest.fn().mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({ jobId: 'job-123' }),
            });
            global.fetch = mockFetch;

            const globalSetup = require('./global-setup').default;
            const mockConfig: any = {
              use: {
                baseURL: 'https://test-origin.example.com',
                regressionbotRunContext: { value: 'from-use' },
              },
            };

            await globalSetup(mockConfig);

            expect(mockFetch).toHaveBeenCalledWith(
              'https://api.regressionbot.com/ci/job/init',
              expect.objectContaining({
                body: JSON.stringify({
                  project: 'env-project',
                  branch: 'main',
                  commit: '',
                  testOrigin: 'https://test-origin.example.com',
                  devices: ['Desktop Chrome'],
                  runContext: { value: 'from-use' },
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
            process.env.REGRESSIONBOT_AWAIT_RESULTS = 'false';

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
            delete process.env.REGRESSIONBOT_AWAIT_RESULTS;
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    });
  });
});
