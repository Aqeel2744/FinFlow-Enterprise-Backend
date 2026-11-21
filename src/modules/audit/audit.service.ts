import { prisma } from '../../config/prisma.js';

export interface CreateAuditLogParams {
  organizationId: string;
  userId?: string;
  action: string;
  entityType: string;
  entityId: string;
  oldState?: any;
  newState?: any;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  static async log(params: CreateAuditLogParams) {
    try {
      return await prisma.auditLog.create({
        data: {
          organizationId: params.organizationId,
          userId: params.userId,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
          oldState: params.oldState ? JSON.parse(JSON.stringify(params.oldState)) : undefined,
          newState: params.newState ? JSON.parse(JSON.stringify(params.newState)) : undefined,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        },
      });
    } catch (err: any) {
      console.error('Failed to persist audit log entry:', err.message);
      // Non-blocking for primary transaction unless strict compliance requested
    }
  }

  static async listLogs(organizationId: string, filter?: { entityType?: string; entityId?: string; limit?: number }) {
    return prisma.auditLog.findMany({
      where: {
        organizationId,
        entityType: filter?.entityType,
        entityId: filter?.entityId,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: filter?.limit || 100,
    });
  }
}
