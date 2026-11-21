import { afterEach, describe, expect, it } from 'vitest';
import { getAppUrl } from '../src/utils/appUrl.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalVercelUrl = process.env.VERCEL_URL;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalVercelUrl === undefined) delete process.env.VERCEL_URL;
  else process.env.VERCEL_URL = originalVercelUrl;
});

function request(headers: Record<string, string>, protocol = 'http') {
  return {
    get: (name: string) => headers[name.toLowerCase()],
    protocol,
  };
}

describe('getAppUrl', () => {
  it('uses the browser origin in development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.VERCEL_URL;

    expect(
      getAppUrl(request({ origin: 'http://localhost:5173', host: 'localhost:5000' }))
    ).toBe('http://localhost:5173');
  });

  it('uses the Vercel deployment host in production instead of an untrusted origin', () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_URL = 'finflow.vercel.app';

    expect(
      getAppUrl(request({ origin: 'https://attacker.example', host: 'backend.internal' }, 'https'))
    ).toBe('https://finflow.vercel.app');
  });

  it('falls back to the request host when Vercel is not available', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL_URL;

    expect(getAppUrl(request({ host: 'app.example' }, 'https'))).toBe('https://app.example');
  });
});
