import { prisma } from '../../config/prisma.js';
import { InvoiceStatus, ExpenseStatus } from '@prisma/client';
import { stringify } from 'csv-stringify/sync';

export interface DateFilterParams {
  startDate?: string;
  endDate?: string;
}

export class ReportService {
  static async getDashboardSummary(organizationId: string, filter?: DateFilterParams) {
    const now = new Date();
    const dateWhere: any = {};
    if (filter?.startDate) dateWhere.gte = new Date(filter.startDate);
    if (filter?.endDate) dateWhere.lte = new Date(filter.endDate);

    // 1. Invoices Aggregates
    const invoices = await prisma.invoice.findMany({
      where: {
        organizationId,
        status: { not: InvoiceStatus.CANCELLED },
        ...(filter?.startDate || filter?.endDate ? { issueDate: dateWhere } : {}),
      },
      select: {
        id: true,
        status: true,
        totalCents: true,
        paidCents: true,
        balanceCents: true,
        dueDate: true,
      },
    });

    let invoicedRevenueCents = BigInt(0);
    let outstandingCents = BigInt(0);
    let overdueCents = BigInt(0);
    let draftInvoicesCount = 0;
    let paidInvoicesCount = 0;

    invoices.forEach((inv) => {
      invoicedRevenueCents += inv.totalCents;
      if (inv.status !== InvoiceStatus.DRAFT) {
        outstandingCents += inv.balanceCents;

        if (new Date(inv.dueDate) < now && Number(inv.balanceCents) > 0) {
          overdueCents += inv.balanceCents;
        }
      } else {
        draftInvoicesCount++;
      }

      if (inv.status === InvoiceStatus.PAID) {
        paidInvoicesCount++;
      }
    });

    // 2. Payments (Actual Collected Cash)
    const payments = await prisma.payment.findMany({
      where: {
        organizationId,
        ...(filter?.startDate || filter?.endDate ? { paymentDate: dateWhere } : {}),
      },
      select: { amountCents: true },
    });

    let collectedCashCents = BigInt(0);
    payments.forEach((p) => {
      collectedCashCents += p.amountCents;
    });

    // 3. Approved Expenses
    const expenses = await prisma.expense.findMany({
      where: {
        organizationId,
        status: { in: [ExpenseStatus.APPROVED, ExpenseStatus.PAID, ExpenseStatus.REIMBURSED] },
        ...(filter?.startDate || filter?.endDate ? { expenseDate: dateWhere } : {}),
      },
      select: { amountCents: true, category: true, department: true },
    });

    let totalExpensesCents = BigInt(0);
    expenses.forEach((e) => {
      totalExpensesCents += e.amountCents;
    });

    // Profit Calculations
    const cashNetProfitCents = collectedCashCents - totalExpensesCents;
    const accrualNetProfitCents = invoicedRevenueCents - totalExpensesCents;

    return {
      invoicedRevenueCents: Number(invoicedRevenueCents),
      collectedCashCents: Number(collectedCashCents),
      outstandingCents: Number(outstandingCents),
      overdueCents: Number(overdueCents),
      totalExpensesCents: Number(totalExpensesCents),
      cashNetProfitCents: Number(cashNetProfitCents),
      accrualNetProfitCents: Number(accrualNetProfitCents),
      totalInvoicesCount: invoices.length,
      paidInvoicesCount,
      draftInvoicesCount,
      totalPaymentsCount: payments.length,
      totalExpensesCount: expenses.length,
    };
  }

  static async getMonthlyTrends(organizationId: string) {
    // Generate past 6 months timeline
    const months: Array<{ month: string; invoiced: number; collected: number; expenses: number }> = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      const monthKey = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });

      const [invoices, payments, expenses] = await Promise.all([
        prisma.invoice.findMany({
          where: {
            organizationId,
            status: { not: InvoiceStatus.CANCELLED },
            issueDate: { gte: start, lte: end },
          },
          select: { totalCents: true },
        }),
        prisma.payment.findMany({
          where: {
            organizationId,
            paymentDate: { gte: start, lte: end },
          },
          select: { amountCents: true },
        }),
        prisma.expense.findMany({
          where: {
            organizationId,
            status: { in: [ExpenseStatus.APPROVED, ExpenseStatus.PAID, ExpenseStatus.REIMBURSED] },
            expenseDate: { gte: start, lte: end },
          },
          select: { amountCents: true },
        }),
      ]);

      const invoicedTotal = invoices.reduce((acc, inv) => acc + Number(inv.totalCents) / 100, 0);
      const collectedTotal = payments.reduce((acc, p) => acc + Number(p.amountCents) / 100, 0);
      const expenseTotal = expenses.reduce((acc, e) => acc + Number(e.amountCents) / 100, 0);

      months.push({
        month: monthKey,
        invoiced: Math.round(invoicedTotal * 100) / 100,
        collected: Math.round(collectedTotal * 100) / 100,
        expenses: Math.round(expenseTotal * 100) / 100,
      });
    }

    return months;
  }

  static async getAccountsReceivableAging(organizationId: string) {
    const now = new Date();

    const openInvoices = await prisma.invoice.findMany({
      where: {
        organizationId,
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] },
        balanceCents: { gt: BigInt(0) },
      },
      select: {
        id: true,
        invoiceNumber: true,
        dueDate: true,
        balanceCents: true,
        customer: { select: { id: true, name: true } },
      },
    });

    let currentCents = BigInt(0);
    let days1To30Cents = BigInt(0);
    let days31To60Cents = BigInt(0);
    let days61To90Cents = BigInt(0);
    let days90PlusCents = BigInt(0);

    openInvoices.forEach((inv) => {
      const due = new Date(inv.dueDate);
      const diffMs = now.getTime() - due.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) {
        currentCents += inv.balanceCents;
      } else if (diffDays <= 30) {
        days1To30Cents += inv.balanceCents;
      } else if (diffDays <= 60) {
        days31To60Cents += inv.balanceCents;
      } else if (diffDays <= 90) {
        days61To90Cents += inv.balanceCents;
      } else {
        days90PlusCents += inv.balanceCents;
      }
    });

    return {
      current: Number(currentCents) / 100,
      days1To30: Number(days1To30Cents) / 100,
      days31To60: Number(days31To60Cents) / 100,
      days61To90: Number(days61To90Cents) / 100,
      days90Plus: Number(days90PlusCents) / 100,
      totalUnpaid:
        Number(currentCents + days1To30Cents + days31To60Cents + days61To90Cents + days90PlusCents) / 100,
    };
  }

  static async getExpenseBreakdown(organizationId: string) {
    const expenses = await prisma.expense.findMany({
      where: {
        organizationId,
        status: { in: [ExpenseStatus.APPROVED, ExpenseStatus.PAID, ExpenseStatus.REIMBURSED] },
      },
      select: { category: true, department: true, amountCents: true },
    });

    const categoryMap: Record<string, number> = {};
    const departmentMap: Record<string, number> = {};

    expenses.forEach((e) => {
      const amount = Number(e.amountCents) / 100;
      categoryMap[e.category] = (categoryMap[e.category] || 0) + amount;
      const dept = e.department || 'General';
      departmentMap[dept] = (departmentMap[dept] || 0) + amount;
    });

    const byCategory = Object.entries(categoryMap).map(([name, value]) => ({
      name,
      value: Math.round(value * 100) / 100,
    }));

    const byDepartment = Object.entries(departmentMap).map(([name, value]) => ({
      name,
      value: Math.round(value * 100) / 100,
    }));

    return { byCategory, byDepartment };
  }

  static async exportCsv(organizationId: string, type: 'invoices' | 'payments' | 'expenses') {
    if (type === 'invoices') {
      const invoices = await prisma.invoice.findMany({
        where: { organizationId },
        include: { customer: true },
        orderBy: { issueDate: 'desc' },
      });

      const records = invoices.map((inv) => ({
        'Invoice Number': inv.invoiceNumber,
        'Customer': inv.customer.name,
        'Issue Date': inv.issueDate.toISOString().split('T')[0],
        'Due Date': inv.dueDate.toISOString().split('T')[0],
        'Status': inv.status,
        'Currency': inv.currency,
        'Total ($)': (Number(inv.totalCents) / 100).toFixed(2),
        'Paid ($)': (Number(inv.paidCents) / 100).toFixed(2),
        'Balance ($)': (Number(inv.balanceCents) / 100).toFixed(2),
      }));

      return stringify(records, { header: true });
    }

    if (type === 'payments') {
      const payments = await prisma.payment.findMany({
        where: { organizationId },
        include: { customer: true, invoice: true },
        orderBy: { paymentDate: 'desc' },
      });

      const records = payments.map((p) => ({
        'Payment ID': p.id,
        'Invoice Number': p.invoice.invoiceNumber,
        'Customer': p.customer.name,
        'Payment Date': p.paymentDate.toISOString().split('T')[0],
        'Payment Method': p.paymentMethod,
        'Reference Number': p.referenceNumber || '',
        'Amount ($)': (Number(p.amountCents) / 100).toFixed(2),
        'Notes': p.notes || '',
      }));

      return stringify(records, { header: true });
    }

    const expenses = await prisma.expense.findMany({
      where: { organizationId },
      include: { vendor: true, submittedByUser: true },
      orderBy: { expenseDate: 'desc' },
    });

    const records = expenses.map((e) => ({
      'Expense ID': e.id,
      'Description': e.description,
      'Category': e.category,
      'Department': e.department || '',
      'Vendor': e.vendor?.name || '',
      'Submitted By': `${e.submittedByUser.firstName} ${e.submittedByUser.lastName}`,
      'Date': e.expenseDate.toISOString().split('T')[0],
      'Status': e.status,
      'Amount ($)': (Number(e.amountCents) / 100).toFixed(2),
    }));

    return stringify(records, { header: true });
  }
}
