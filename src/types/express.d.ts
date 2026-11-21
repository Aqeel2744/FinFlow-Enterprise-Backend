import { Role, MembershipStatus } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        firstName: string;
        lastName: string;
      };
      organizationId?: string;
      membership?: {
        id: string;
        role: Role;
        status: MembershipStatus;
        organizationId: string;
      };
      idempotencyKey?: string;
      idempotencyFingerprint?: string;
    }
  }
}
