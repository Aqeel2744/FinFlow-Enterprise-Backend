import { prisma } from '../../config/prisma.js';
import { NotFoundError, ConflictError } from '../../utils/errors.js';
import { AuditService } from '../audit/audit.service.js';

export interface CustomerFilterParams {
  search?: string;
  isArchived?: boolean;
  page?: number;
  limit?: number;
}

export class CustomerService {
  static async listCustomers(organizationId: string, params: CustomerFilterParams) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (params.isArchived !== undefined) {
      where.isArchived = params.isArchived;
    }

    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { email: { contains: params.search, mode: 'insensitive' } },
        { taxNumber: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: { invoices: true },
          },
        },
      }),
      prisma.customer.count({ where }),
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

  static async getCustomerById(organizationId: string, customerId: string) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      include: {
        invoices: {
          take: 10,
          orderBy: { issueDate: 'desc' },
        },
        payments: {
          take: 10,
          orderBy: { paymentDate: 'desc' },
        },
      },
    });

    if (!customer) {
      throw new NotFoundError('Customer not found in this organization');
    }

    return customer;
  }

  static async createCustomer(
    organizationId: string,
    userId: string,
    data: {
      name: string;
      email: string;
      phone?: string;
      taxNumber?: string;
      billingAddress?: string;
      paymentTermsDays?: number;
    }
  ) {
    const existing = await prisma.customer.findFirst({
      where: { organizationId, email: data.email.toLowerCase().trim() },
    });

    if (existing) {
      throw new ConflictError('A customer with this email already exists in this organization.');
    }

    const customer = await prisma.customer.create({
      data: {
        organizationId,
        name: data.name.trim(),
        email: data.email.toLowerCase().trim(),
        phone: data.phone?.trim(),
        taxNumber: data.taxNumber?.trim(),
        billingAddress: data.billingAddress?.trim(),
        paymentTermsDays: data.paymentTermsDays || 30,
      },
    });

    await AuditService.log({
      organizationId,
      userId,
      action: 'CUSTOMER_CREATED',
      entityType: 'Customer',
      entityId: customer.id,
      newState: customer,
    });

    return customer;
  }

  static async updateCustomer(
    organizationId: string,
    userId: string,
    customerId: string,
    data: {
      name?: string;
      email?: string;
      phone?: string;
      taxNumber?: string;
      billingAddress?: string;
      paymentTermsDays?: number;
      isArchived?: boolean;
    }
  ) {
    const existing = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Customer not found');
    }

    const updated = await prisma.customer.update({
      where: { id: customerId },
      data: {
        ...data,
        email: data.email ? data.email.toLowerCase().trim() : undefined,
      },
    });

    await AuditService.log({
      organizationId,
      userId,
      action: 'CUSTOMER_UPDATED',
      entityType: 'Customer',
      entityId: customerId,
      oldState: existing,
      newState: updated,
    });

    return updated;
  }

  static async deleteCustomer(organizationId: string, userId: string, customerId: string) {
    const existing = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      include: { _count: { select: { invoices: true, payments: true } } },
    });

    if (!existing) {
      throw new NotFoundError('Customer not found');
    }

    if (existing._count.invoices > 0 || existing._count.payments > 0) {
      // Historical financial records exist: archive safely to preserve historical audit trail
      const archived = await prisma.customer.update({
        where: { id: customerId },
        data: { isArchived: true },
      });

      await AuditService.log({
        organizationId,
        userId,
        action: 'CUSTOMER_ARCHIVED',
        entityType: 'Customer',
        entityId: customerId,
        oldState: existing,
        newState: archived,
      });

      return { message: 'Customer has financial invoice history and has been archived instead of deleted.', archived: true };
    }

    await prisma.customer.delete({ where: { id: customerId } });

    await AuditService.log({
      organizationId,
      userId,
      action: 'CUSTOMER_DELETED',
      entityType: 'Customer',
      entityId: customerId,
      oldState: existing,
    });

    return { message: 'Customer deleted successfully.', archived: false };
  }
}
