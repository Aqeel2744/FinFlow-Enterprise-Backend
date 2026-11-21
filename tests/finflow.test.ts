import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../src/app.js';
import { calculateLineItem, dollarsToCents, centsToDollars, formatCents } from '../src/utils/currency.js';
import { prisma } from '../src/config/prisma.js';

describe('1. Financial Precision & Exact Currency Arithmetic', () => {
  it('converts dollars to integer cents without floating point precision drift', () => {
    expect(dollarsToCents(10.5)).toBe(BigInt(1050));
    expect(dollarsToCents('19.99')).toBe(BigInt(1999));
    expect(dollarsToCents(0.1 + 0.2)).toBe(BigInt(30)); // Immune to JS 0.30000000000000004
  });

  it('converts integer cents back to dollars accurately', () => {
    expect(centsToDollars(BigInt(1050))).toBe(10.5);
    expect(centsToDollars(BigInt(1999))).toBe(19.99);
  });

  it('calculates line item subtotal, discount, tax and grand total with deterministic integer math', () => {
    // 2 units @ $100.00 = $200.00, 10% discount = -$20.00, 5% tax on $180.00 = +$9.00 -> Total $189.00
    const calc = calculateLineItem(2, dollarsToCents(100), 10, 5);

    expect(calc.subtotalCents).toBe(BigInt(20000));
    expect(calc.discountCents).toBe(BigInt(2000));
    expect(calc.taxCents).toBe(BigInt(900));
    expect(calc.totalCents).toBe(BigInt(18900));
  });

  it('formats cents correctly into localized currency strings', () => {
    expect(formatCents(BigInt(123456), 'USD')).toBe('$1,234.56');
  });
});

describe('2. Authentication & Tenant Authorization APIs', () => {
  let ownerToken: string;
  let employeeToken: string;
  let acmeOrgId: string;

  it('successfully authenticates Organization Owner (Sarah Jenkins)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'sarah.cfo@acme.com',
        password: 'Password123!',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tokens.accessToken).toBeDefined();
    expect(res.body.data.organizations.length).toBeGreaterThan(0);

    ownerToken = res.body.data.tokens.accessToken;
    acmeOrgId = res.body.data.organizations[0].id;
  });

  it('successfully authenticates Employee (Alex Chen)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'alex.dev@acme.com',
        password: 'Password123!',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    employeeToken = res.body.data.tokens.accessToken;
  });

  it('creates an active member with a temporary password that works for login', async () => {
    const email = `invite-${crypto.randomUUID()}@example.com`;

    try {
      const inviteRes = await request(app)
        .post('/api/v1/organizations/members/invite')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-organization-id', acmeOrgId)
        .send({ email, role: 'EMPLOYEE' });

      expect(inviteRes.status).toBe(201);
      expect(inviteRes.body.data.membership.status).toBe('ACTIVE');
      expect(inviteRes.body.data.membership.inviteToken).toBeNull();
      expect(inviteRes.body.data.temporaryPassword).toHaveLength(32);

      const initialPassword = inviteRes.body.data.temporaryPassword;
      const initialLoginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: initialPassword });

      expect(initialLoginRes.status).toBe(200);
      expect(initialLoginRes.body.data.organizations).toContainEqual(
        expect.objectContaining({ id: acmeOrgId, status: 'ACTIVE', role: 'EMPLOYEE' })
      );

      const resetRes = await request(app)
        .post(`/api/v1/organizations/members/${inviteRes.body.data.membership.id}/reset-password`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-organization-id', acmeOrgId);

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.newPassword).toHaveLength(32);
      expect(resetRes.body.newPassword).not.toBe(initialPassword);

      const oldPasswordLoginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: initialPassword });
      expect(oldPasswordLoginRes.status).toBe(401);

      const resetPasswordLoginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: resetRes.body.newPassword });
      expect(resetPasswordLoginRes.status).toBe(200);
    } finally {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('adds an existing account without changing its password', async () => {
    const email = `existing-${crypto.randomUUID()}@example.com`;
    const password = 'ExistingPassword123!';

    try {
      const registerRes = await request(app)
        .post('/api/v1/auth/register')
        .send({ email, password, firstName: 'Existing', lastName: 'Member' });
      expect(registerRes.status).toBe(201);

      const inviteRes = await request(app)
        .post('/api/v1/organizations/members/invite')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-organization-id', acmeOrgId)
        .send({ email, role: 'ACCOUNTANT' });

      expect(inviteRes.status).toBe(201);
      expect(inviteRes.body.data.membership.status).toBe('ACTIVE');
      expect(inviteRes.body.data.temporaryPassword).toBeUndefined();

      const loginRes = await request(app).post('/api/v1/auth/login').send({ email, password });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.data.organizations).toContainEqual(
        expect.objectContaining({ id: acmeOrgId, status: 'ACTIVE', role: 'ACCOUNTANT' })
      );
    } finally {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('rejects access to protected tenant endpoints without an authentication token', async () => {
    const res = await request(app).get('/api/v1/invoices');
    expect(res.status).toBe(401);
  });

  it('enforces RBAC: prevents standard EMPLOYEE from creating invoices', async () => {
    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${employeeToken}`)
      .set('x-organization-id', acmeOrgId)
      .send({
        customerId: '00000000-0000-0000-0000-000000000000',
        dueDate: '2026-12-31',
        items: [{ description: 'Unauthorized Invoice', quantity: 1, unitPrice: 100 }],
      });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('FORBIDDEN');
  });
});

describe('3. Invoices, Payments & Financial Invariants', () => {
  let ownerToken: string;
  let acmeOrgId: string;
  let customerId: string;
  let createdInvoiceId: string;

  beforeAll(async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sarah.cfo@acme.com', password: 'Password123!' });

    ownerToken = loginRes.body.data.tokens.accessToken;
    acmeOrgId = loginRes.body.data.organizations[0].id;

    // Fetch existing customer
    const custRes = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', acmeOrgId);

    customerId = custRes.body.items[0].id;
  });

  it('creates a new DRAFT invoice with exact line items', async () => {
    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', acmeOrgId)
      .send({
        customerId,
        dueDate: '2026-06-30',
        notes: 'Net 30 Payment Terms',
        items: [
          {
            description: 'Architecture Advisory Sprints',
            quantity: 2,
            unitPrice: 1500, // $1,500 * 2 = $3,000
            discountPercent: 10, // -$300
            taxPercent: 5, // +$135 -> $2,835
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.invoiceNumber).toMatch(/^INV-\d{4}-\d{4}$/);
    expect(res.body.data.totalCents).toBe(283500); // $2,835.00
    expect(res.body.data.balanceCents).toBe(283500);

    createdInvoiceId = res.body.data.id;
  });

  it('enforces financial invariant: rejects payment on DRAFT invoice', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', acmeOrgId)
      .send({
        invoiceId: createdInvoiceId,
        amount: 1000,
        paymentMethod: 'BANK_TRANSFER',
      });

    expect(res.status).toBe(422);
    expect(res.body.message).toContain('Cannot record payment against a DRAFT invoice');
  });

  it('transitions invoice status from DRAFT to ISSUED', async () => {
    const res = await request(app)
      .post(`/api/v1/invoices/${createdInvoiceId}/issue`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', acmeOrgId);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ISSUED');
  });

  it('enforces financial invariant: rejects overpayment exceeding balance', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', acmeOrgId)
      .send({
        invoiceId: createdInvoiceId,
        amount: 5000, // Balance is $2,835.00
        paymentMethod: 'BANK_TRANSFER',
      });

    expect(res.status).toBe(422);
    expect(res.body.message).toContain('exceeds remaining invoice balance');
  });

  it('records partial payment and enforces balance consistency', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', acmeOrgId)
      .set('Idempotency-Key', `idem-partial-test-${Date.now()}`)
      .send({
        invoiceId: createdInvoiceId,
        amount: 1000, // $1,000 partial payment
        paymentMethod: 'BANK_TRANSFER',
        referenceNumber: 'WIRE-TEST-1',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.invoice.status).toBe('PARTIALLY_PAID');
    expect(res.body.data.invoice.paidCents).toBe(100000);
    expect(res.body.data.invoice.balanceCents).toBe(183500); // $2,835 - $1,000 = $1,835
  });

  it('enforces Idempotency-Key deduplication for financial mutations', async () => {
    const idempotencyKey = `idem-key-duplicate-check-${Date.now()}`;

    // First request
    const firstRes = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', acmeOrgId)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        invoiceId: createdInvoiceId,
        amount: 500,
        paymentMethod: 'BANK_TRANSFER',
      });

    expect(firstRes.status).toBe(201);

    // Exact retry with identical payload and key -> returns cached result without creating a duplicate record
    const secondRes = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', acmeOrgId)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        invoiceId: createdInvoiceId,
        amount: 500,
        paymentMethod: 'BANK_TRANSFER',
      });

    expect(secondRes.status).toBe(201);
    expect(secondRes.headers['x-idempotent-replay']).toBe('true');
  });

  it('generates a valid binary PDF invoice stream', async () => {
    const res = await request(app)
      .get(`/api/v1/invoices/${createdInvoiceId}/pdf`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', acmeOrgId);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.length).toBeGreaterThan(100);
  });
});

describe('4. Expense Management & Self-Approval Prevention Policy', () => {
  let employeeToken: string;
  let financeManagerToken: string;
  let acmeOrgId: string;
  let createdExpenseId: string;

  beforeAll(async () => {
    const empLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'alex.dev@acme.com', password: 'Password123!' });

    employeeToken = empLogin.body.data.tokens.accessToken;
    acmeOrgId = empLogin.body.data.organizations[0].id;

    const mgrLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'marcus.finance@acme.com', password: 'Password123!' });

    financeManagerToken = mgrLogin.body.data.tokens.accessToken;
  });

  it('allows employee to submit a business expense claim', async () => {
    const res = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${employeeToken}`)
      .set('x-organization-id', acmeOrgId)
      .send({
        category: 'Travel',
        department: 'Engineering',
        amount: 650, // $650.00 (> policy threshold of $500, so requires approval)
        description: 'Regional Technical Conference Flight & Lodging',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('SUBMITTED');
    createdExpenseId = res.body.data.id;
  });

  it('strictly prevents employee from self-approving their own expense claim', async () => {
    const res = await request(app)
      .post(`/api/v1/approvals/${createdExpenseId}/decide`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .set('x-organization-id', acmeOrgId)
      .send({
        action: 'APPROVED',
        comments: 'Self-approval attempt',
      });

    // Blocked by RBAC or self-approval policy
    expect(res.status).toBe(403);
  });

  it('allows authorized Finance Manager to approve the expense request', async () => {
    const res = await request(app)
      .post(`/api/v1/approvals/${createdExpenseId}/decide`)
      .set('Authorization', `Bearer ${financeManagerToken}`)
      .set('x-organization-id', acmeOrgId)
      .send({
        action: 'APPROVED',
        comments: 'Approved per conference budget authorization.',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.expense.status).toBe('APPROVED');
  });
});

describe('5. Observability & Health Endpoints', () => {
  it('responds to /health check with status healthy and uptime', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.uptimeSeconds).toBeDefined();
  });
});
