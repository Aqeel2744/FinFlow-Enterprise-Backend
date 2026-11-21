import { Request, Response, NextFunction } from 'express';
import { ExpenseService } from './expense.service.js';
import { ExpenseStatus } from '@prisma/client';
import { z } from 'zod';

const submitExpenseSchema = z.object({
  vendorId: z.string().uuid().optional().or(z.literal('')),
  category: z.string().min(1, 'Category is required'),
  department: z.string().optional(),
  project: z.string().optional(),
  amount: z.coerce.number().positive('Amount must be positive'),
  expenseDate: z.string().optional(),
  description: z.string().min(2, 'Description is required').trim(),
});

export class ExpenseController {
  static async submit(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = submitExpenseSchema.parse(req.body);
      const receiptFile = req.file;

      const expense = await ExpenseService.submitExpense(
        req.organizationId!,
        req.user!.id,
        {
          ...validated,
          vendorId: validated.vendorId || undefined,
          receiptBuffer: receiptFile?.buffer,
          receiptMimeType: receiptFile?.mimetype,
        }
      );

      return res.status(201).json({
        success: true,
        message: 'Expense claim submitted successfully',
        data: expense,
      });
    } catch (error) {
      next(error);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, category, department, startDate, endDate, page, limit } = req.query;
      const result = await ExpenseService.listExpenses(
        req.organizationId!,
        req.user!.id,
        req.membership!.role,
        {
          status: status as ExpenseStatus,
          category: category as string,
          department: department as string,
          startDate: startDate as string,
          endDate: endDate as string,
          page: page ? parseInt(page as string) : undefined,
          limit: limit ? parseInt(limit as string) : undefined,
        }
      );
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const expense = await ExpenseService.getExpenseById(
        req.organizationId!,
        req.user!.id,
        req.membership!.role,
        req.params.id
      );
      return res.status(200).json({ success: true, data: expense });
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const expense = await ExpenseService.updateExpense(
        req.organizationId!,
        req.user!.id,
        req.membership!.role,
        req.params.id,
        req.body
      );
      return res.status(200).json({ success: true, message: 'Expense updated successfully', data: expense });
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ExpenseService.deleteExpense(
        req.organizationId!,
        req.user!.id,
        req.membership!.role,
        req.params.id
      );
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
}
