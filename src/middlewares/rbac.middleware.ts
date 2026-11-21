import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';

export function requireRole(allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.membership) {
      return next(new UnauthorizedError('Tenant membership context required for authorization'));
    }

    const currentRole = req.membership.role;

    // Normalize ORG_OWNER / OWNER compatibility
    const effectiveRoles = [...allowedRoles];
    if (allowedRoles.includes('ORG_OWNER') && !effectiveRoles.includes('OWNER')) {
      effectiveRoles.push('OWNER');
    }
    if (allowedRoles.includes('OWNER') && !effectiveRoles.includes('ORG_OWNER')) {
      effectiveRoles.push('ORG_OWNER');
    }

    if (!effectiveRoles.includes(currentRole)) {
      return next(
        new ForbiddenError(
          `Action forbidden: Your role (${currentRole}) lacks the necessary privileges. Required: [${allowedRoles.join(', ')}]`
        )
      );
    }

    next();
  };
}

/**
 * Standard enterprise role group helpers
 */
export const allowOwnersAndFinance = requireRole([
  Role.PLATFORM_ADMIN,
  Role.ORG_OWNER,
  Role.OWNER,
  Role.FINANCE_MANAGER,
]);

export const allowAccountingStaff = requireRole([
  Role.PLATFORM_ADMIN,
  Role.ORG_OWNER,
  Role.OWNER,
  Role.FINANCE_MANAGER,
  Role.ACCOUNTANT,
]);

export const allowAllMembers = requireRole([
  Role.PLATFORM_ADMIN,
  Role.ORG_OWNER,
  Role.OWNER,
  Role.FINANCE_MANAGER,
  Role.ACCOUNTANT,
  Role.EMPLOYEE,
  Role.AUDITOR,
]);
