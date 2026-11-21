import { Request, Response, NextFunction } from 'express';
import { CustomerService } from './customer.service.js';
import { z } from 'zod';

const customerSchema = z.object({
  name: z.string().min(2, 'Name is required').trim(),
  email: z.string().email('Valid email is required').trim(),
  phone: z.string().optional(),
  taxNumber: z.string().optional(),
  billingAddress: z.string().optional(),
  paymentTermsDays: z.coerce.number().min(0).default(30),
  isArchived: z.boolean().optional(),
});

export class CustomerController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { search, isArchived, page, limit } = req.query;
      const result = await CustomerService.listCustomers(req.organizationId!, {
        search: search as string,
        isArchived: isArchived !== undefined ? isArchived === 'true' : undefined,
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
      const customer = await CustomerService.getCustomerById(req.organizationId!, req.params.id);
      return res.status(200).json({ success: true, data: customer });
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = customerSchema.parse(req.body);
      const customer = await CustomerService.createCustomer(req.organizationId!, req.user!.id, validated);
      return res.status(201).json({ success: true, data: customer });
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = customerSchema.partial().parse(req.body);
      const customer = await CustomerService.updateCustomer(
        req.organizationId!,
        req.user!.id,
        req.params.id,
        validated
      );
      return res.status(200).json({ success: true, data: customer });
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await CustomerService.deleteCustomer(
        req.organizationId!,
        req.user!.id,
        req.params.id
      );
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
}
