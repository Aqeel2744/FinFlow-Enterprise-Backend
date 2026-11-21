import { Request, Response, NextFunction } from 'express';
import { PaymentService } from './payment.service.js';
import { PaymentMethod } from '@prisma/client';
import { z } from 'zod';

const recordPaymentSchema = z.object({
  invoiceId: z.string().uuid('Valid invoice ID is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  paymentDate: z.string().optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.BANK_TRANSFER),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});

export class PaymentController {
  static async record(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = recordPaymentSchema.parse(req.body);
      const result = await PaymentService.recordPayment(
        req.organizationId!,
        req.user!.id,
        validated,
        req.idempotencyKey
      );
      return res.status(201).json({
        success: true,
        message: 'Payment recorded successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { invoiceId, customerId, paymentMethod, startDate, endDate, page, limit } = req.query;
      const result = await PaymentService.listPayments(req.organizationId!, {
        invoiceId: invoiceId as string,
        customerId: customerId as string,
        paymentMethod: paymentMethod as PaymentMethod,
        startDate: startDate as string,
        endDate: endDate as string,
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
      });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
}
