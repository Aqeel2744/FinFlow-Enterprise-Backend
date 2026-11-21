import { prisma } from '../../config/prisma.js';
import { NotFoundError } from '../../utils/errors.js';
import { AuditService } from '../audit/audit.service.js';

export interface VendorFilterParams {
  search?: string;
  category?: string;
  isArchived?: boolean;
  page?: number;
  limit?: number;
}

export class VendorService {
  static async listVendors(organizationId: string, params: VendorFilterParams) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (params.isArchived !== undefined) {
      where.isArchived = params.isArchived;
    }

    if (params.category) {
      where.category = params.category;
    }

    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { email: { contains: params.search, mode: 'insensitive' } },
        { category: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.vendor.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: { expenses: true },
          },
        },
      }),
      prisma.vendor.count({ where }),
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

  static async getVendorById(organizationId: string, vendorId: string) {
    const vendor = await prisma.vendor.findFirst({
      where: { id: vendorId, organizationId },
      include: {
        expenses: {
          take: 10,
          orderBy: { expenseDate: 'desc' },
        },
      },
    });

    if (!vendor) {
      throw new NotFoundError('Vendor not found in this organization');
    }

    return vendor;
  }

  static async createVendor(
    organizationId: string,
    userId: string,
    data: {
      name: string;
      email?: string;
      phone?: string;
      taxNumber?: string;
      billingAddress?: string;
      category?: string;
    }
  ) {
    const vendor = await prisma.vendor.create({
      data: {
        organizationId,
        name: data.name.trim(),
        email: data.email?.toLowerCase().trim(),
        phone: data.phone?.trim(),
        taxNumber: data.taxNumber?.trim(),
        billingAddress: data.billingAddress?.trim(),
        category: data.category?.trim(),
      },
    });

    await AuditService.log({
      organizationId,
      userId,
      action: 'VENDOR_CREATED',
      entityType: 'Vendor',
      entityId: vendor.id,
      newState: vendor,
    });

    return vendor;
  }

  static async updateVendor(
    organizationId: string,
    userId: string,
    vendorId: string,
    data: {
      name?: string;
      email?: string;
      phone?: string;
      taxNumber?: string;
      billingAddress?: string;
      category?: string;
      isArchived?: boolean;
    }
  ) {
    const existing = await prisma.vendor.findFirst({
      where: { id: vendorId, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Vendor not found');
    }

    const updated = await prisma.vendor.update({
      where: { id: vendorId },
      data: {
        ...data,
        email: data.email ? data.email.toLowerCase().trim() : undefined,
      },
    });

    await AuditService.log({
      organizationId,
      userId,
      action: 'VENDOR_UPDATED',
      entityType: 'Vendor',
      entityId: vendorId,
      oldState: existing,
      newState: updated,
    });

    return updated;
  }

  static async deleteVendor(organizationId: string, userId: string, vendorId: string) {
    const existing = await prisma.vendor.findFirst({
      where: { id: vendorId, organizationId },
      include: { _count: { select: { expenses: true } } },
    });

    if (!existing) {
      throw new NotFoundError('Vendor not found');
    }

    if (existing._count.expenses > 0) {
      const archived = await prisma.vendor.update({
        where: { id: vendorId },
        data: { isArchived: true },
      });

      await AuditService.log({
        organizationId,
        userId,
        action: 'VENDOR_ARCHIVED',
        entityType: 'Vendor',
        entityId: vendorId,
        oldState: existing,
        newState: archived,
      });

      return { message: 'Vendor has associated expenses and has been archived.', archived: true };
    }

    await prisma.vendor.delete({ where: { id: vendorId } });

    await AuditService.log({
      organizationId,
      userId,
      action: 'VENDOR_DELETED',
      entityType: 'Vendor',
      entityId: vendorId,
      oldState: existing,
    });

    return { message: 'Vendor deleted successfully.', archived: false };
  }
}
