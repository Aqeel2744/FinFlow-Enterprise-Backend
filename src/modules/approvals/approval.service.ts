import { prisma } from '../../config/prisma.js';
import { ExpenseStatus, ApprovalActionType, Role } from '@prisma/client';
import { NotFoundError, ForbiddenError, UnprocessableEntityError } from '../../utils/errors.js';
import { AuditService } from '../audit/audit.service.js';

export interface ProcessApprovalDto {
  action: ApprovalActionType;
  comments?: string;
}

export class ApprovalService {
  static async listPendingApprovals(organizationId: string) {
    return prisma.expense.findMany({
      where: {
        organizationId,
        status: ExpenseStatus.SUBMITTED,
      },
      include: {
        submittedByUser: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        vendor: {
          select: { id: true, name: true },
        },
      },
      orderBy: { expenseDate: 'asc' },
    });
  }

  static async processApproval(
    organizationId: string,
    approverUserId: string,
    approverRole: Role,
    expenseId: string,
    dto: ProcessApprovalDto
  ) {
    // Execute atomic transaction for safe state transition and concurrency control
    return prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findFirst({
        where: { id: expenseId, organizationId },
      });

      if (!expense) {
        throw new NotFoundError('Expense request not found in this organization');
      }

      // Invariant: Status check
      if (expense.status !== ExpenseStatus.SUBMITTED) {
        throw new UnprocessableEntityError(
          `Cannot process approval: expense is in '${expense.status}' status. Only 'SUBMITTED' requests can be decided.`
        );
      }

      // Invariant: Self-Approval Prevention Policy
      if (expense.submittedByUserId === approverUserId) {
        throw new ForbiddenError(
          'Policy violation: Employees are strictly prohibited from approving their own expense claims.'
        );
      }

      // Check policy role authorization
      const allowedRoles: Role[] = [Role.PLATFORM_ADMIN, Role.ORG_OWNER, Role.OWNER, Role.FINANCE_MANAGER];
      if (!allowedRoles.includes(approverRole)) {
        throw new ForbiddenError(
          'Insufficient privileges: Only Finance Managers or Organization Owners can approve expenses.'
        );
      }

      let newStatus: ExpenseStatus;
      if (dto.action === ApprovalActionType.APPROVED) {
        newStatus = ExpenseStatus.APPROVED;
      } else if (dto.action === ApprovalActionType.REJECTED) {
        newStatus = ExpenseStatus.REJECTED;
      } else {
        newStatus = ExpenseStatus.NEEDS_CHANGES;
      }

      // Record approval decision in immutable audit chain
      const action = await tx.approvalAction.create({
        data: {
          organizationId,
          expenseId: expense.id,
          approverUserId,
          action: dto.action,
          comments: dto.comments?.trim(),
        },
        include: {
          approverUser: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });

      // Update expense status
      const updatedExpense = await tx.expense.update({
        where: { id: expense.id },
        data: { status: newStatus },
        include: {
          submittedByUser: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      // Create notification for expense submitter
      await tx.notification.create({
        data: {
          organizationId,
          userId: expense.submittedByUserId,
          title: `Expense ${dto.action}`,
          message: `Your expense "${expense.description}" of $${Number(expense.amountCents) / 100} has been ${dto.action.toLowerCase()}${dto.comments ? ': ' + dto.comments : '.'}`,
          type: dto.action === ApprovalActionType.APPROVED ? 'SUCCESS' : 'WARNING',
          link: `/expenses/${expense.id}`,
        },
      });

      // Log financial audit trail
      await AuditService.log({
        organizationId,
        userId: approverUserId,
        action: `EXPENSE_${dto.action}`,
        entityType: 'Expense',
        entityId: expense.id,
        oldState: { status: expense.status },
        newState: { status: newStatus, comments: dto.comments },
      });

      return {
        action,
        expense: updatedExpense,
      };
    });
  }
}
