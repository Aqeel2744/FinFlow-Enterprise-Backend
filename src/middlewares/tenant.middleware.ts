import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import { prisma } from '../config/prisma.js';

export async function requireTenant(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required before tenant resolution');
    }

    const orgIdHeader = req.headers['x-organization-id'] as string | undefined;
    const orgIdParam = req.params.organizationId;
    let targetOrgId = orgIdHeader || orgIdParam;

    // If client did not specify an org header, fetch the user's active memberships
    if (!targetOrgId) {
      const firstActiveMembership = await prisma.membership.findFirst({
        where: {
          userId: req.user.id,
          status: 'ACTIVE',
        },
        orderBy: { createdAt: 'asc' },
      });

      if (!firstActiveMembership) {
        throw new ForbiddenError('You are not associated with any active organization. Please create or accept an invitation to an organization.');
      }

      targetOrgId = firstActiveMembership.organizationId;
    }

    // Verify membership & status in target organization
    const membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: req.user.id,
          organizationId: targetOrgId,
        },
      },
      include: {
        organization: true,
      },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenError('Access denied: You do not have an active membership in this organization.');
    }

    // Attach verified server-side tenant context
    req.organizationId = targetOrgId;
    req.membership = {
      id: membership.id,
      role: membership.role,
      status: membership.status,
      organizationId: membership.organizationId,
    };

    next();
  } catch (error) {
    next(error);
  }
}
