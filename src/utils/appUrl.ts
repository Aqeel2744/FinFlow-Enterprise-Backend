import type { Request } from 'express';

type RequestUrlContext = Pick<Request, 'get' | 'protocol'>;

export function getAppUrl(req: RequestUrlContext): string {
  const requestOrigin = req.get('origin');
  const requestHost = req.get('host');

  if (process.env.NODE_ENV !== 'production' && requestOrigin) {
    return new URL(requestOrigin).origin;
  }

  if (requestOrigin && requestHost) {
    const originUrl = new URL(requestOrigin);
    if (originUrl.host === requestHost) return originUrl.origin;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  if (!requestHost) {
    throw new Error('Unable to determine the application host for generated links.');
  }

  return `${req.protocol}://${requestHost}`;
}
