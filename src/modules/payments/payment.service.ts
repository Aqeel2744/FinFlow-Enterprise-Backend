import { prisma } from '../../config/prisma.js';
import { PaymentMethod, InvoiceStatus } from '@prisma/client';
import { NotFoundError, BadRequestError, UnprocessableEntityError } from '../../utils/errors.js';
import { dollarsToCents } from '../../utils/currency.js';
import { AuditService } from '../audit/audit.service.js';

export interface RecordPaymentDto {
  invoiceId: string;
  amount: number; // in dollars (e.g. 50.00)
  paymentDate?: string;
  paymentMethod: PaymentMethod;
  referenceNumber?: string;
  notes?: string;
}

export interface PaymentFilterParams {
  invoiceId?: string;
  customerId?: string;
  paymentMethod?: PaymentMethod;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export class PaymentService {
  static async recordPayment(
    organizationId: string,
    userId: string,
    data: RecordPaymentDto,
    idempotencyKey?: string
  ) {
    const paymentAmountCents = dollarsToCents(data.amount);

    if (paymentAmountCents <= BigInt(0)) {
      throw new BadRequestError('Payment amount must be greater than zero');
    }

    // Execute atomic transaction to prevent race conditions and enforce financial balance invariants
    return prisma.$transaction(async (tx) => {
      // 1. Fetch target invoice within tenant boundary
      const invoice = await tx.invoice.findFirst({
        where: { id: data.invoiceId, organizationId },
      });

      if (!invoice) {
        throw new NotFoundError('Invoice not found in this organization');
      }

      // 2. Enforce Status Invariant
      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new UnprocessableEntityError('Payments cannot be accepted against a CANCELLED invoice.');
      }

      if (invoice.status === InvoiceStatus.DRAFT) {
        throw new UnprocessableEntityError('Cannot record payment against a DRAFT invoice. Please issue the invoice first.');
      }

      if (invoice.status === InvoiceStatus.PAID || Number(invoice.balanceCents) === 0) {
        throw new UnprocessableEntityError('Invoice is already fully paid. Balance is zero.');
      }

      // 3. Enforce Strict Balance Invariant: No Overpayment
      if (paymentAmountCents > invoice.balanceCents) {
        throw new UnprocessableEntityError(
          `Payment amount ($${Number(paymentAmountCents) / 100}) exceeds remaining invoice balance ($${Number(invoice.balanceCents) / 100}).`
        );
      }

      // 4. Compute updated financial states
      const newPaidCents = invoice.paidCents + paymentAmountCents;
      const newBalanceCents = invoice.totalCents - newPaidCents;
      const newStatus = newBalanceCents === BigInt(0) ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

      // 5. Create Payment record
      const payment = await tx.payment.create({
        data: {
          organizationId,
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          amountCents: paymentAmountCents,
          currency: invoice.currency,
          paymentDate: data.paymentDate ? new Date(data.paymentDate) : new Date(),
          paymentMethod: data.paymentMethod || PaymentMethod.BANK_TRANSFER,
          referenceNumber: data.referenceNumber?.trim(),
          notes: data.notes?.trim(),
          recordedByUserId: userId,
          idempotencyKeyId: idempotencyKey,
        },
        include: {
          recordedByUser: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });

      // 6. Update Invoice with optimistic version increment
      const updatedInvoice = await tx.invoice.update({
        where: {
          id: invoice.id,
          version: invoice.version, // optimistic lock check
        },
        data: {
          paidCents: newPaidCents,
          balanceCents: newBalanceCents,
          status: newStatus,
          version: { increment: 1 },
        },
      });

      // 7. Persist audit log
      await AuditService.log({
        organizationId,
        userId,
        action: 'PAYMENT_RECORDED',
        entityType: 'Payment',
        entityId: payment.id,
        newState: {
          paymentId: payment.id,
          amountCents: Number(paymentAmountCents),
          invoiceId: invoice.id,
          newStatus,
          remainingBalanceCents: Number(newBalanceCents),
        },
      });

      return {
        payment,
        invoice: updatedInvoice,
      };
    });
  }

  static async listPayments(organizationId: string, params: PaymentFilterParams) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (params.invoiceId) where.invoiceId = params.invoiceId;
    if (params.customerId) where.customerId = params.customerId;
    if (params.paymentMethod) where.paymentMethod = params.paymentMethod;

    if (params.startDate || params.endDate) {
      where.paymentDate = {};
      if (params.startDate) where.paymentDate.gte = new Date(params.startDate);
      if (params.endDate) where.paymentDate.lte = new Date(params.endDate);
    }

    const [items, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { paymentDate: 'desc' },
        include: {
          invoice: {
            select: { id: true, invoiceNumber: true, totalCents: true, status: true },
          },
          customer: {
            select: { id: true, name: true, email: true },
          },
          recordedByUser: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
      prisma.payment.count({ where }),
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
}
