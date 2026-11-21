import { prisma } from '../../config/prisma.js';
import { InvoiceStatus } from '@prisma/client';
import { NotFoundError, BadRequestError, UnprocessableEntityError } from '../../utils/errors.js';
import { calculateLineItem, dollarsToCents } from '../../utils/currency.js';
import { AuditService } from '../audit/audit.service.js';
import { generateInvoicePdf } from '../../utils/pdfGenerator.js';

export interface CreateInvoiceItemDto {
  description: string;
  quantity: number;
  unitPrice: number; // in dollars (e.g. 150.00)
  taxPercent?: number;
  discountPercent?: number;
}

export interface CreateInvoiceDto {
  customerId: string;
  dueDate: string;
  notes?: string;
  terms?: string;
  currency?: string;
  items: CreateInvoiceItemDto[];
}

export interface InvoiceFilterParams {
  customerId?: string;
  status?: InvoiceStatus;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export class InvoiceService {
  private static async getNextInvoiceNumber(organizationId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;

    const latestInvoice = await prisma.invoice.findFirst({
      where: {
        organizationId,
        invoiceNumber: { startsWith: prefix },
      },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true },
    });

    let nextNumber = 1;
    if (latestInvoice && latestInvoice.invoiceNumber) {
      const parts = latestInvoice.invoiceNumber.split('-');
      if (parts.length === 3) {
        const lastSeq = parseInt(parts[2], 10);
        if (!isNaN(lastSeq)) {
          nextNumber = lastSeq + 1;
        }
      }
    }

    return `${prefix}${String(nextNumber).padStart(4, '0')}`;
  }

  static async listInvoices(organizationId: string, params: InvoiceFilterParams) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (params.customerId) where.customerId = params.customerId;
    if (params.status) where.status = params.status;

    if (params.search) {
      where.OR = [
        { invoiceNumber: { contains: params.search, mode: 'insensitive' } },
        { customer: { name: { contains: params.search, mode: 'insensitive' } } },
      ];
    }

    if (params.startDate || params.endDate) {
      where.issueDate = {};
      if (params.startDate) where.issueDate.gte = new Date(params.startDate);
      if (params.endDate) where.issueDate.lte = new Date(params.endDate);
    }

    const [items, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { issueDate: 'desc' },
        include: {
          customer: {
            select: { id: true, name: true, email: true },
          },
          _count: {
            select: { payments: true, items: true },
          },
        },
      }),
      prisma.invoice.count({ where }),
    ]);

    // Compute dynamic overdue state if past due date
    const now = new Date();
    const mappedItems = items.map((inv) => {
      let currentStatus = inv.status;
      if (
        (currentStatus === 'ISSUED' || currentStatus === 'PARTIALLY_PAID') &&
        new Date(inv.dueDate) < now &&
        Number(inv.balanceCents) > 0
      ) {
        currentStatus = 'OVERDUE';
      }
      return {
        ...inv,
        status: currentStatus,
      };
    });

    return {
      items: mappedItems,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async getInvoiceById(organizationId: string, invoiceId: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: {
        customer: true,
        items: true,
        payments: {
          orderBy: { paymentDate: 'desc' },
          include: {
            recordedByUser: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
        createdByUser: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundError('Invoice not found in this organization');
    }

    // Check overdue
    let status = invoice.status;
    if (
      (status === 'ISSUED' || status === 'PARTIALLY_PAID') &&
      new Date(invoice.dueDate) < new Date() &&
      Number(invoice.balanceCents) > 0
    ) {
      status = 'OVERDUE';
    }

    return { ...invoice, status };
  }

  static async createInvoice(organizationId: string, userId: string, data: CreateInvoiceDto) {
    if (!data.items || data.items.length === 0) {
      throw new BadRequestError('Invoice must contain at least one line item');
    }

    // Verify customer belongs to organization
    const customer = await prisma.customer.findFirst({
      where: { id: data.customerId, organizationId },
    });

    if (!customer) {
      throw new NotFoundError('Customer not found in this organization');
    }

    // Calculate line items exact financial cents
    let subtotalCents = BigInt(0);
    let discountCents = BigInt(0);
    let taxCents = BigInt(0);
    let totalCents = BigInt(0);

    const calculatedItems = data.items.map((item) => {
      const unitPriceCents = dollarsToCents(item.unitPrice);
      const calc = calculateLineItem(
        item.quantity,
        unitPriceCents,
        item.discountPercent || 0,
        item.taxPercent || 0
      );

      subtotalCents += calc.subtotalCents;
      discountCents += calc.discountCents;
      taxCents += calc.taxCents;
      totalCents += calc.totalCents;

      return {
        description: item.description,
        quantity: calc.quantity,
        unitPriceCents: calc.unitPriceCents,
        discountPercent: calc.discountPercent,
        taxPercent: calc.taxPercent,
        totalCents: calc.totalCents,
      };
    });

    const invoiceNumber = await this.getNextInvoiceNumber(organizationId);

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          organizationId,
          customerId: data.customerId,
          invoiceNumber,
          status: InvoiceStatus.DRAFT,
          currency: data.currency || 'USD',
          subtotalCents,
          discountCents,
          taxCents,
          totalCents,
          paidCents: BigInt(0),
          balanceCents: totalCents,
          issueDate: new Date(),
          dueDate: new Date(data.dueDate),
          notes: data.notes,
          terms: data.terms,
          createdByUserId: userId,
          items: {
            create: calculatedItems.map((item) => ({
              organizationId,
              description: item.description,
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
              discountPercent: item.discountPercent,
              taxPercent: item.taxPercent,
              totalCents: item.totalCents,
            })),
          },
        },
        include: {
          items: true,
          customer: true,
        },
      });

      return created;
    });

    await AuditService.log({
      organizationId,
      userId,
      action: 'INVOICE_CREATED',
      entityType: 'Invoice',
      entityId: invoice.id,
      newState: { invoiceNumber, totalCents: Number(totalCents) },
    });

    return invoice;
  }

  static async updateDraftInvoice(
    organizationId: string,
    userId: string,
    invoiceId: string,
    data: Partial<CreateInvoiceDto>
  ) {
    const existing = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: { items: true },
    });

    if (!existing) {
      throw new NotFoundError('Invoice not found');
    }

    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new UnprocessableEntityError('Issued or paid invoices cannot be modified. Only DRAFT invoices are editable.');
    }

    return prisma.$transaction(async (tx) => {
      let subtotalCents = existing.subtotalCents;
      let discountCents = existing.discountCents;
      let taxCents = existing.taxCents;
      let totalCents = existing.totalCents;

      if (data.items && data.items.length > 0) {
        // Delete old items
        await tx.invoiceItem.deleteMany({ where: { invoiceId } });

        subtotalCents = BigInt(0);
        discountCents = BigInt(0);
        taxCents = BigInt(0);
        totalCents = BigInt(0);

        const calculatedItems = data.items.map((item) => {
          const unitPriceCents = dollarsToCents(item.unitPrice);
          const calc = calculateLineItem(
            item.quantity,
            unitPriceCents,
            item.discountPercent || 0,
            item.taxPercent || 0
          );

          subtotalCents += calc.subtotalCents;
          discountCents += calc.discountCents;
          taxCents += calc.taxCents;
          totalCents += calc.totalCents;

          return {
            organizationId,
            invoiceId,
            description: item.description,
            quantity: calc.quantity,
            unitPriceCents: calc.unitPriceCents,
            discountPercent: calc.discountPercent,
            taxPercent: calc.taxPercent,
            totalCents: calc.totalCents,
          };
        });

        await tx.invoiceItem.createMany({ data: calculatedItems });
      }

      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
          notes: data.notes !== undefined ? data.notes : undefined,
          terms: data.terms !== undefined ? data.terms : undefined,
          subtotalCents,
          discountCents,
          taxCents,
          totalCents,
          balanceCents: totalCents - existing.paidCents,
          version: { increment: 1 },
        },
        include: { items: true, customer: true },
      });

      await AuditService.log({
        organizationId,
        userId,
        action: 'INVOICE_UPDATED',
        entityType: 'Invoice',
        entityId: invoiceId,
        oldState: existing,
        newState: updated,
      });

      return updated;
    });
  }

  static async issueInvoice(organizationId: string, userId: string, invoiceId: string) {
    const existing = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: { items: true },
    });

    if (!existing) throw new NotFoundError('Invoice not found');

    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new UnprocessableEntityError(`Invoice cannot be issued from status: ${existing.status}`);
    }

    if (existing.items.length === 0) {
      throw new BadRequestError('Cannot issue an invoice with zero line items');
    }

    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.ISSUED,
        issueDate: new Date(),
        version: { increment: 1 },
      },
      include: { customer: true, items: true },
    });

    await AuditService.log({
      organizationId,
      userId,
      action: 'INVOICE_ISSUED',
      entityType: 'Invoice',
      entityId: invoiceId,
      newState: { status: InvoiceStatus.ISSUED, issueDate: updated.issueDate },
    });

    return updated;
  }

  static async cancelInvoice(organizationId: string, userId: string, invoiceId: string, reason?: string) {
    const existing = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
    });

    if (!existing) throw new NotFoundError('Invoice not found');

    if (Number(existing.paidCents) > 0) {
      throw new UnprocessableEntityError('Cannot cancel an invoice with recorded payments. Please refund or issue a credit note first.');
    }

    if (existing.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestError('Invoice is already cancelled');
    }

    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.CANCELLED,
        notes: reason ? `${existing.notes || ''}\n[Cancelled]: ${reason}` : existing.notes,
        version: { increment: 1 },
      },
    });

    await AuditService.log({
      organizationId,
      userId,
      action: 'INVOICE_CANCELLED',
      entityType: 'Invoice',
      entityId: invoiceId,
      oldState: existing,
      newState: updated,
    });

    return updated;
  }

  static async deleteInvoice(organizationId: string, userId: string, invoiceId: string) {
    const existing = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Invoice not found');
    }

    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new UnprocessableEntityError(
        `Cannot delete invoice in '${existing.status}' status. Only DRAFT invoices can be deleted. Issued invoices must be cancelled to preserve financial audit compliance.`
      );
    }

    await prisma.$transaction([
      prisma.invoiceItem.deleteMany({ where: { invoiceId } }),
      prisma.invoice.delete({ where: { id: invoiceId } }),
    ]);

    await AuditService.log({
      organizationId,
      userId,
      action: 'INVOICE_DELETED',
      entityType: 'Invoice',
      entityId: invoiceId,
      oldState: existing,
    });

    return { message: 'Draft invoice deleted successfully' };
  }

  static async generatePdf(organizationId: string, invoiceId: string): Promise<Buffer> {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: {
        organization: true,
        customer: true,
        items: true,
      },
    });

    if (!invoice) throw new NotFoundError('Invoice not found');

    return generateInvoicePdf({
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      currency: invoice.currency,
      subtotalCents: invoice.subtotalCents,
      discountCents: invoice.discountCents,
      taxCents: invoice.taxCents,
      totalCents: invoice.totalCents,
      paidCents: invoice.paidCents,
      balanceCents: invoice.balanceCents,
      notes: invoice.notes,
      terms: invoice.terms,
      organization: invoice.organization,
      customer: invoice.customer,
      items: invoice.items,
    });
  }
}
