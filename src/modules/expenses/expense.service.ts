import { prisma } from '../../config/prisma.js';
import { ExpenseStatus, Role } from '@prisma/client';
import { NotFoundError, BadRequestError, ForbiddenError, UnprocessableEntityError } from '../../utils/errors.js';
import { dollarsToCents } from '../../utils/currency.js';
import { AuditService } from '../audit/audit.service.js';
import { cloudinary } from '../../config/cloudinary.js';
import { geminiModel } from '../../config/gemini.js';

export interface SubmitExpenseDto {
  vendorId?: string;
  category: string;
  department?: string;
  project?: string;
  amount: number; // in dollars
  expenseDate?: string;
  description: string;
  receiptBuffer?: Buffer;
  receiptMimeType?: string;
}

export interface ExpenseFilterParams {
  status?: ExpenseStatus;
  category?: string;
  department?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export class ExpenseService {
  static async submitExpense(
    organizationId: string,
    userId: string,
    data: SubmitExpenseDto
  ) {
    const amountCents = dollarsToCents(data.amount);

    if (amountCents <= BigInt(0)) {
      throw new BadRequestError('Expense amount must be greater than zero');
    }

    // 1. Handle receipt upload to Cloudinary if provided
    let receiptUrl: string | undefined;
    let receiptPublicId: string | undefined;

    if (data.receiptBuffer && cloudinary) {
      try {
        const uploadResult = await new Promise<any>((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: `finflow/${organizationId}/receipts` },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          stream.end(data.receiptBuffer);
        });

        receiptUrl = uploadResult.secure_url;
        receiptPublicId = uploadResult.public_id;
      } catch (err: any) {
        console.warn('Receipt upload to Cloudinary failed, proceeding with local placeholder:', err.message);
      }
    }

    // 2. AI Advisory Checks (Advisory only, never modifies balances or makes final decisions)
    let aiFlagged = false;
    let aiFlagReason: string | null = null;
    let aiSuggestedCategory = data.category;

    // Rule-based heuristic flag: expenses over $2,500
    if (Number(amountCents) > 250000) {
      aiFlagged = true;
      aiFlagReason = 'Expense amount exceeds $2,500 threshold, flagged for senior finance review.';
    }

    // Gemini AI Advisory categorization check if available
    if (geminiModel && data.description) {
      try {
        const prompt = `You are a financial advisory AI. Given the expense description "${data.description}" and amount $${data.amount}, classify it into one of: Travel, Software, Meals, Office Supplies, Hardware, Marketing, Legal, Other. Return ONLY the category name.`;
        const result = await geminiModel.generateContent(prompt);
        const text = result.response.text()?.trim();
        if (text && text.length < 30) {
          aiSuggestedCategory = text;
        }
      } catch (aiErr) {
        // Advisory AI failure should not interrupt financial operation
      }
    }

    // 3. Check organization approval policy
    const policy = await prisma.approvalPolicy.findFirst({
      where: { organizationId },
      orderBy: { minAmountCents: 'desc' },
    });

    let initialStatus: ExpenseStatus = ExpenseStatus.SUBMITTED;
    if (policy && policy.autoApproveBelowCents && amountCents < policy.autoApproveBelowCents) {
      initialStatus = ExpenseStatus.APPROVED;
    }

    // 4. Create Expense record
    const expense = await prisma.expense.create({
      data: {
        organizationId,
        submittedByUserId: userId,
        vendorId: data.vendorId || null,
        category: data.category,
        department: data.department,
        project: data.project,
        amountCents,
        expenseDate: data.expenseDate ? new Date(data.expenseDate) : new Date(),
        description: data.description.trim(),
        receiptUrl,
        receiptPublicId,
        status: initialStatus,
        aiFlagged,
        aiFlagReason,
        aiSuggestedCategory,
      },
      include: {
        submittedByUser: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        vendor: true,
      },
    });

    await AuditService.log({
      organizationId,
      userId,
      action: 'EXPENSE_SUBMITTED',
      entityType: 'Expense',
      entityId: expense.id,
      newState: {
        id: expense.id,
        amountCents: Number(amountCents),
        status: initialStatus,
        category: expense.category,
      },
    });

    return expense;
  }

  static async listExpenses(
    organizationId: string,
    userId: string,
    role: Role,
    params: ExpenseFilterParams
  ) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    // Strict Role Scoping: Standard employees can only view their own expense claims
    if (role === Role.EMPLOYEE) {
      where.submittedByUserId = userId;
    }

    if (params.status) where.status = params.status;
    if (params.category) where.category = params.category;
    if (params.department) where.department = params.department;

    if (params.startDate || params.endDate) {
      where.expenseDate = {};
      if (params.startDate) where.expenseDate.gte = new Date(params.startDate);
      if (params.endDate) where.expenseDate.lte = new Date(params.endDate);
    }

    const [items, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        skip,
        take: limit,
        orderBy: { expenseDate: 'desc' },
        include: {
          submittedByUser: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          vendor: {
            select: { id: true, name: true },
          },
          approvalActions: {
            include: {
              approverUser: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
        },
      }),
      prisma.expense.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async getExpenseById(
    organizationId: string,
    userId: string,
    role: Role,
    expenseId: string
  ) {
    const expense = await prisma.expense.findFirst({
      where: { id: expenseId, organizationId },
      include: {
        submittedByUser: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        vendor: true,
        approvalActions: {
          orderBy: { createdAt: 'desc' },
          include: {
            approverUser: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        },
      },
    });

    if (!expense) {
      throw new NotFoundError('Expense not found in this organization');
    }

    if (role === Role.EMPLOYEE && expense.submittedByUserId !== userId) {
      throw new ForbiddenError('You are not authorized to view another employee\'s expense claim.');
    }

    return expense;
  }

 
  static async updateExpense(
    organizationId: string,
    userId: string,
    role: Role,
    expenseId: string,
    data: {
      description?: string;
      amount?: number;
      category?: string;
      department?: string;
      project?: string;
      vendorId?: string | null;
      status?: ExpenseStatus;
    }
  ) {
    const existing = await prisma.expense.findFirst({
      where: { id: expenseId, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Expense claim not found');
    }

    // Role Guard
    if (role === Role.AUDITOR) {
      throw new ForbiddenError(
        'Auditors have read-only access and cannot modify expenses.'
      );
    }

    const isManagerOrOwner =
      role === Role.PLATFORM_ADMIN ||
      role === Role.ORG_OWNER ||
      role === Role.OWNER ||
      role === Role.FINANCE_MANAGER;

    if (!isManagerOrOwner && existing.submittedByUserId !== userId) {
      throw new ForbiddenError(
        'You are not authorized to modify another employee\'s expense claim.'
      );
    }

    // Status Guard
    if (
      existing.status === ExpenseStatus.PAID ||
      existing.status === ExpenseStatus.REIMBURSED
    ) {
      throw new UnprocessableEntityError(
        'Cannot modify an expense that has already been reimbursed or paid.'
      );
    }

    if (!isManagerOrOwner && existing.status === ExpenseStatus.APPROVED) {
      throw new UnprocessableEntityError(
        'Approved expenses cannot be altered by employees. Contact your Finance Manager.'
      );
    }

    let amountCents = existing.amountCents;

    if (data.amount !== undefined) {
      amountCents = dollarsToCents(data.amount);

      if (amountCents <= BigInt(0)) {
        throw new BadRequestError('Expense amount must be greater than zero');
      }
    }

    // If an employee updates a claim that was requested changes,
    // return it to SUBMITTED.
    let newStatus = existing.status;

    if (
      existing.status === ExpenseStatus.NEEDS_CHANGES ||
      existing.status === ExpenseStatus.REJECTED
    ) {
      newStatus = ExpenseStatus.SUBMITTED;
    }

    if (isManagerOrOwner && data.status !== undefined) {
      // Payment settlement must be handled through the payment workflow.
      if (
        data.status === ExpenseStatus.PAID ||
        data.status === ExpenseStatus.REIMBURSED
      ) {
        throw new UnprocessableEntityError(
          'PAID and REIMBURSED statuses must be handled through the payment workflow.'
        );
      }

      newStatus = data.status;
    }

    const updated = await prisma.expense.update({
      where: { id: expenseId },
      data: {
        description:
          data.description !== undefined
            ? data.description.trim()
            : undefined,
        amountCents,
        category: data.category !== undefined ? data.category : undefined,
        department: data.department !== undefined ? data.department : undefined,
        project: data.project !== undefined ? data.project : undefined,
        vendorId: data.vendorId !== undefined ? data.vendorId : undefined,
        status: newStatus,
      },
      include: {
        submittedByUser: {
          select: { id: true, firstName: true, lastName: true },
        },
        vendor: true,
      },
    });

    await AuditService.log({
      organizationId,
      userId,
      action: 'EXPENSE_UPDATED',
      entityType: 'Expense',
      entityId: expenseId,
      oldState: existing,
      newState: updated,
    });

    return updated;
  }

  static async deleteExpense(
    organizationId: string,
    userId: string,
    role: Role,
    expenseId: string
  ) {
    const existing = await prisma.expense.findFirst({
      where: { id: expenseId, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Expense claim not found');
    }

    if (role === Role.AUDITOR) {
      throw new ForbiddenError(
        'Auditors have read-only access and cannot delete expenses.'
      );
    }

    const isManagerOrOwner =
      role === Role.PLATFORM_ADMIN ||
      role === Role.ORG_OWNER ||
      role === Role.OWNER ||
      role === Role.FINANCE_MANAGER;

    if (!isManagerOrOwner && existing.submittedByUserId !== userId) {
      throw new ForbiddenError(
        'You cannot delete another employee\'s expense claim.'
      );
    }

    if (
      existing.status === ExpenseStatus.APPROVED ||
      existing.status === ExpenseStatus.PAID ||
      existing.status === ExpenseStatus.REIMBURSED
    ) {
      throw new UnprocessableEntityError(
        'Approved or settled expenses cannot be deleted to maintain compliance audit trails.'
      );
    }

    await prisma.$transaction([
      prisma.approvalAction.deleteMany({ where: { expenseId } }),
      prisma.expense.delete({ where: { id: expenseId } }),
    ]);

    await AuditService.log({
      organizationId,
      userId,
      action: 'EXPENSE_DELETED',
      entityType: 'Expense',
      entityId: expenseId,
      oldState: existing,
    });

    return { message: 'Expense claim deleted successfully' };
  }

}
