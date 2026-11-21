import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/prisma.js';
import { ConflictError } from '../utils/errors.js';

export function idempotency(options?: { required?: boolean }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = (req.headers['idempotency-key'] as string | undefined)?.trim();

    if (!key) {
      if (options?.required) {
        return res.status(400).json({
          success: false,
          errorCode: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'An Idempotency-Key header is required for this financial mutation.',
        });
      }
      return next();
    }

    if (!req.organizationId) {
      return next();
    }

    try {
      // 1. Generate canonical fingerprint of the incoming request
      const payloadString = JSON.stringify(req.body || {});
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${req.method}:${req.baseUrl + req.path}:${payloadString}`)
        .digest('hex');

      req.idempotencyKey = key;
      req.idempotencyFingerprint = fingerprint;

      // 2. Check for existing idempotency record
      const existingRecord = await prisma.idempotencyRecord.findUnique({
        where: {
          organizationId_key: {
            organizationId: req.organizationId,
            key,
          },
        },
      });

      if (existingRecord) {
        // Reject if the same key was used for a different payload
        if (existingRecord.requestFingerprint !== fingerprint) {
          throw new ConflictError(
            'Idempotency key conflict: This key was previously used with a different request payload or endpoint.'
          );
        }

        // Return cached result
        res.setHeader('X-Idempotent-Replay', 'true');
        return res
          .status(existingRecord.responseStatusCode)
          .json(existingRecord.responseBody);
      }

      // 3. Intercept res.json to persist successful outcome
      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        // Only persist non-error 2xx and 3xx responses
        if (res.statusCode >= 200 && res.statusCode < 400 && req.organizationId) {
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours retention
          
          prisma.idempotencyRecord
            .upsert({
              where: {
                organizationId_key: {
                  organizationId: req.organizationId,
                  key,
                },
              },
              create: {
                organizationId: req.organizationId,
                key,
                endpoint: `${req.method} ${req.baseUrl + req.path}`,
                requestFingerprint: fingerprint,
                responseStatusCode: res.statusCode,
                responseBody: body,
                expiresAt,
              },
              update: {
                responseStatusCode: res.statusCode,
                responseBody: body,
              },
            })
            .catch((err) => {
              console.error('Failed to store idempotency record:', err.message);
            });
        }

        return originalJson(body);
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}
