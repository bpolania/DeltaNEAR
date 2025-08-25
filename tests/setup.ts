// Test setup file
import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Increase timeout for integration tests
if (process.env.TEST_TYPE === 'integration' || process.env.TEST_TYPE === 'e2e') {
  jest.setTimeout(30000);
}

// Mock console.error for cleaner test output
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: any[]) => {
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('Warning:') || args[0].includes('punycode'))
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});

// Clean up any hanging processes
afterAll(async () => {
  await new Promise(resolve => setTimeout(resolve, 1000));
});