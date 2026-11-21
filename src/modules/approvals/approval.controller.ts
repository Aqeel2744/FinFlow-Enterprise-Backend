import { Request, Response, NextFunction } from 'express';
import { ApprovalService } from './approval.service.js';
import { ApprovalActionType } from '@prisma/client';
import { z } from 'zod';

const approvalSchema = z.object({
  action: z.nativeEnum(ApprovalActionType),
  comments: z.string().optional(),
});

export class ApprovalController {
  static async listPending(req: Request, res: Response, next: NextFunction) {
    try {
      const pending = await ApprovalService.listPendingApprovals(req.organizationId!);
      return res.status(200).json({ success: true, data: pending });
    } catch (error) {
      next(error);
    }
  }

  static async decide(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = approvalSchema.parse(req.body);
      const result = await ApprovalService.processApproval(
        req.organizationId!,
        req.user!.id,
        req.membership!.role,
        req.params.expenseId,
        validated
      );
      return res.status(200).json({
        success: true,
        message: `Expense claim ${validated.action.toLowerCase()} successfully`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}
