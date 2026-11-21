import { Request, Response, NextFunction } from 'express';
import { VendorService } from './vendor.service.js';
import { z } from 'zod';

const vendorSchema = z.object({
  name: z.string().min(2, 'Name is required').trim(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  taxNumber: z.string().optional(),
  billingAddress: z.string().optional(),
  category: z.string().optional(),
  isArchived: z.boolean().optional(),
});

export class VendorController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { search, category, isArchived, page, limit } = req.query;
      const result = await VendorService.listVendors(req.organizationId!, {
        search: search as string,
        category: category as string,
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
      const vendor = await VendorService.getVendorById(req.organizationId!, req.params.id);
      return res.status(200).json({ success: true, data: vendor });
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = vendorSchema.parse(req.body);
      const vendor = await VendorService.createVendor(req.organizationId!, req.user!.id, {
        ...validated,
        email: validated.email || undefined,
      });
      return res.status(201).json({ success: true, data: vendor });
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = vendorSchema.partial().parse(req.body);
      const vendor = await VendorService.updateVendor(
        req.organizationId!,
        req.user!.id,
        req.params.id,
        {
          ...validated,
          email: validated.email || undefined,
        }
      );
      return res.status(200).json({ success: true, data: vendor });
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await VendorService.deleteVendor(
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
