import { Request, Response, NextFunction } from 'express';
import { InvoiceService } from './invoice.service.js';
import { InvoiceStatus } from '@prisma/client';
import { z } from 'zod';

const createInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  dueDate: z.string(),
  notes: z.string().optional(),
  terms: z.string().optional(),
  currency: z.string().length(3).default('USD'),
  items: z.array(
    z.object({
      description: z.string().min(1, 'Description required'),
      quantity: z.coerce.number().min(1),
      unitPrice: z.coerce.number().min(0),
      taxPercent: z.coerce.number().min(0).max(100).optional(),
      discountPercent: z.coerce.number().min(0).max(100).optional(),
    })
  ).min(1, 'At least one line item is required'),
});

export class InvoiceController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { customerId, status, search, startDate, endDate, page, limit } = req.query;
      const result = await InvoiceService.listInvoices(req.organizationId!, {
        customerId: customerId as string,
        status: status as InvoiceStatus,
        search: search as string,
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

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const invoice = await InvoiceService.getInvoiceById(req.organizationId!, req.params.id);
      return res.status(200).json({ success: true, data: invoice });
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = createInvoiceSchema.parse(req.body);
      const invoice = await InvoiceService.createInvoice(req.organizationId!, req.user!.id, validated);
      return res.status(201).json({ success: true, data: invoice });
    } catch (error) {
      next(error);
    }
  }

  static async updateDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = createInvoiceSchema.partial().parse(req.body);
      const invoice = await InvoiceService.updateDraftInvoice(
        req.organizationId!,
        req.user!.id,
        req.params.id,
        validated as any
      );
      return res.status(200).json({ success: true, data: invoice });
    } catch (error) {
      next(error);
    }
  }

  static async issue(req: Request, res: Response, next: NextFunction) {
    try {
      const invoice = await InvoiceService.issueInvoice(req.organizationId!, req.user!.id, req.params.id);
      return res.status(200).json({ success: true, message: 'Invoice issued successfully', data: invoice });
    } catch (error) {
      next(error);
    }
  }

  static async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const { reason } = req.body;
      const invoice = await InvoiceService.cancelInvoice(req.organizationId!, req.user!.id, req.params.id, reason);
      return res.status(200).json({ success: true, message: 'Invoice cancelled', data: invoice });
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await InvoiceService.deleteInvoice(req.organizationId!, req.user!.id, req.params.id);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  static async downloadPdf(req: Request, res: Response, next: NextFunction) {
    try {
      const pdfBuffer = await InvoiceService.generatePdf(req.organizationId!, req.params.id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Invoice-${req.params.id}.pdf"`);
      return res.send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  }
}
