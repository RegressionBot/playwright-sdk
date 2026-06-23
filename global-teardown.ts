import { finalizeJob } from './index';

async function globalTeardown() {
  await finalizeJob();
}

export default globalTeardown;
