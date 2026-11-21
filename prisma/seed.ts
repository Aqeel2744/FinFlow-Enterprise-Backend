import { PrismaClient, Role, InvoiceStatus, PaymentMethod, ExpenseStatus, ApprovalActionType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { calculateLineItem, dollarsToCents } from '../src/utils/currency.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting comprehensive FinFlow database seeding...');

  // Clean existing seed data safely if re-running
  console.log('Clearing old records...');
  await prisma.approvalAction.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.idempotencyRecord.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.approvalPolicy.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('Password123!', salt);

  console.log('Creating enterprise users with 6 standard roles...');
  const users = {
    admin: await prisma.user.create({
      data: {
        email: 'admin@finflow.io',
        passwordHash,
        firstName: 'System',
        lastName: 'Admin',
        isVerified: true,
      },
    }),
    owner: await prisma.user.create({
      data: {
        email: 'sarah.cfo@acme.com',
        passwordHash,
        firstName: 'Sarah',
        lastName: 'Jenkins',
        isVerified: true,
      },
    }),
    financeManager: await prisma.user.create({
      data: {
        email: 'marcus.finance@acme.com',
        passwordHash,
        firstName: 'Marcus',
        lastName: 'Vance',
        isVerified: true,
      },
    }),
    accountant: await prisma.user.create({
      data: {
        email: 'elena.accountant@acme.com',
        passwordHash,
        firstName: 'Elena',
        lastName: 'Rostova',
        isVerified: true,
      },
    }),
    employee: await prisma.user.create({
      data: {
        email: 'alex.dev@acme.com',
        passwordHash,
        firstName: 'Alex',
        lastName: 'Chen',
        isVerified: true,
      },
    }),
    auditor: await prisma.user.create({
      data: {
        email: 'victor.auditor@auditfirm.com',
        passwordHash,
        firstName: 'Victor',
        lastName: 'Stone',
        isVerified: true,
      },
    }),
  };

  console.log('Creating organizations...');
  const acmeOrg = await prisma.organization.create({
    data: {
      name: 'Acme Global Technologies',
      slug: 'acme-global',
      currency: 'USD',
      timezone: 'America/New_York',
      taxId: 'US-94829104',
      address: '100 Innovation Way, Suite 400, New York, NY 10001',
      phone: '+1 (212) 555-0199',
    },
  });

  const nexusOrg = await prisma.organization.create({
    data: {
      name: 'Nexus Cloud Systems',
      slug: 'nexus-cloud',
      currency: 'USD',
      timezone: 'America/Los_Angeles',
      taxId: 'US-82710492',
      address: '500 Silicon Vista Blvd, San Francisco, CA 94107',
    },
  });

  console.log('Assigning memberships and tenant roles...');
  await prisma.membership.createMany({
    data: [
      { userId: users.admin.id, organizationId: acmeOrg.id, role: Role.PLATFORM_ADMIN },
      { userId: users.owner.id, organizationId: acmeOrg.id, role: Role.ORG_OWNER },
      { userId: users.financeManager.id, organizationId: acmeOrg.id, role: Role.FINANCE_MANAGER },
      { userId: users.accountant.id, organizationId: acmeOrg.id, role: Role.ACCOUNTANT },
      { userId: users.employee.id, organizationId: acmeOrg.id, role: Role.EMPLOYEE },
      { userId: users.auditor.id, organizationId: acmeOrg.id, role: Role.AUDITOR },
      // Nexus memberships (multi-tenant test)
      { userId: users.owner.id, organizationId: nexusOrg.id, role: Role.ORG_OWNER },
      { userId: users.employee.id, organizationId: nexusOrg.id, role: Role.EMPLOYEE },
    ],
  });

  console.log('Setting approval policies...');
  await prisma.approvalPolicy.create({
    data: {
      organizationId: acmeOrg.id,
      name: 'Standard Tier Approval Policy',
      minAmountCents: BigInt(50000), // $500 requires approval
      requiredRole: Role.FINANCE_MANAGER,
      autoApproveBelowCents: BigInt(50000), // < $500 auto-approved
    },
  });

  console.log('Creating customers...');
  const customers = [
    await prisma.customer.create({
      data: {
        organizationId: acmeOrg.id,
        name: 'Wayne Enterprises',
        email: 'billing@waynecorp.com',
        phone: '+1 (555) 234-5678',
        taxNumber: 'US-84920419',
        billingAddress: '1007 Mountain Drive, Gotham City, NY',
        paymentTermsDays: 30,
      },
    }),
    await prisma.customer.create({
      data: {
        organizationId: acmeOrg.id,
        name: 'Stark Industries',
        email: 'finance@stark.com',
        phone: '+1 (555) 987-6543',
        taxNumber: 'US-19402847',
        billingAddress: '10880 Wilshire Blvd, Los Angeles, CA',
        paymentTermsDays: 15,
      },
    }),
    await prisma.customer.create({
      data: {
        organizationId: acmeOrg.id,
        name: 'Pied Piper Tech',
        email: 'richard@piedpiper.com',
        phone: '+1 (555) 432-1098',
        taxNumber: 'US-50192843',
        billingAddress: '5230 Newell Rd, Palo Alto, CA',
        paymentTermsDays: 30,
      },
    }),
  ];

  console.log('Creating vendors...');
  const vendors = [
    await prisma.vendor.create({
      data: {
        organizationId: acmeOrg.id,
        name: 'Amazon Web Services',
        email: 'invoicing@aws.amazon.com',
        category: 'Software',
        taxNumber: 'US-91029384',
      },
    }),
    await prisma.vendor.create({
      data: {
        organizationId: acmeOrg.id,
        name: 'Delta Air Lines',
        email: 'corporate@delta.com',
        category: 'Travel',
      },
    }),
    await prisma.vendor.create({
      data: {
        organizationId: acmeOrg.id,
        name: 'Herman Miller Office Solutions',
        email: 'sales@hermanmiller.com',
        category: 'Office Supplies',
      },
    }),
  ];

  console.log('Creating invoices across distinct states...');
  // 1. Paid Invoice
  const item1 = calculateLineItem(1, dollarsToCents(5000), 0, 8); // $5,000 + 8% tax = $5,400
  const invPaid = await prisma.invoice.create({
    data: {
      organizationId: acmeOrg.id,
      customerId: customers[0].id,
      invoiceNumber: 'INV-2026-0001',
      status: InvoiceStatus.PAID,
      currency: 'USD',
      subtotalCents: item1.subtotalCents,
      taxCents: item1.taxCents,
      discountCents: item1.discountCents,
      totalCents: item1.totalCents,
      paidCents: item1.totalCents,
      balanceCents: BigInt(0),
      issueDate: new Date('2026-01-10'),
      dueDate: new Date('2026-02-10'),
      createdByUserId: users.accountant.id,
      items: {
        create: [
          {
            organizationId: acmeOrg.id,
            description: 'Annual Enterprise SaaS Licensing Platform',
            quantity: item1.quantity,
            unitPriceCents: item1.unitPriceCents,
            taxPercent: item1.taxPercent,
            discountPercent: item1.discountPercent,
            totalCents: item1.totalCents,
          },
        ],
      },
    },
  });

  // Record payment for paid invoice
  await prisma.payment.create({
    data: {
      organizationId: acmeOrg.id,
      invoiceId: invPaid.id,
      customerId: customers[0].id,
      amountCents: item1.totalCents,
      currency: 'USD',
      paymentDate: new Date('2026-01-25'),
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      referenceNumber: 'WIRE-98234-ACME',
      notes: 'Full balance settled via corporate wire transfer.',
      recordedByUserId: users.accountant.id,
    },
  });

  // 2. Partially Paid Invoice
  const item2 = calculateLineItem(2, dollarsToCents(4000), 10, 5); // 2 * $4000 = $8000 - $800 disc = $7200 + $360 tax = $7560
  const partialPaymentCents = BigInt(350000); // $3,500 paid
  const invPartiallyPaid = await prisma.invoice.create({
    data: {
      organizationId: acmeOrg.id,
      customerId: customers[1].id,
      invoiceNumber: 'INV-2026-0002',
      status: InvoiceStatus.PARTIALLY_PAID,
      currency: 'USD',
      subtotalCents: item2.subtotalCents,
      discountCents: item2.discountCents,
      taxCents: item2.taxCents,
      totalCents: item2.totalCents,
      paidCents: partialPaymentCents,
      balanceCents: item2.totalCents - partialPaymentCents,
      issueDate: new Date('2026-02-01'),
      dueDate: new Date('2026-03-01'),
      createdByUserId: users.accountant.id,
      items: {
        create: [
          {
            organizationId: acmeOrg.id,
            description: 'Cloud Infrastructure Architecture & Security Review',
            quantity: item2.quantity,
            unitPriceCents: item2.unitPriceCents,
            discountPercent: item2.discountPercent,
            taxPercent: item2.taxPercent,
            totalCents: item2.totalCents,
          },
        ],
      },
    },
  });

  await prisma.payment.create({
    data: {
      organizationId: acmeOrg.id,
      invoiceId: invPartiallyPaid.id,
      customerId: customers[1].id,
      amountCents: partialPaymentCents,
      currency: 'USD',
      paymentDate: new Date('2026-02-14'),
      paymentMethod: PaymentMethod.CREDIT_CARD,
      referenceNumber: 'CC-AUTH-77391',
      notes: 'Initial milestone payment of 50%.',
      recordedByUserId: users.accountant.id,
    },
  });

  // 3. Issued (Unpaid) Invoice
  const item3 = calculateLineItem(1, dollarsToCents(3200), 0, 0);
  await prisma.invoice.create({
    data: {
      organizationId: acmeOrg.id,
      customerId: customers[2].id,
      invoiceNumber: 'INV-2026-0003',
      status: InvoiceStatus.ISSUED,
      currency: 'USD',
      subtotalCents: item3.subtotalCents,
      discountCents: BigInt(0),
      taxCents: BigInt(0),
      totalCents: item3.totalCents,
      paidCents: BigInt(0),
      balanceCents: item3.totalCents,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000), // Due in 20 days
      createdByUserId: users.accountant.id,
      items: {
        create: [
          {
            organizationId: acmeOrg.id,
            description: 'Monthly Managed Services & DevOps Support',
            quantity: item3.quantity,
            unitPriceCents: item3.unitPriceCents,
            totalCents: item3.totalCents,
          },
        ],
      },
    },
  });

  // 4. Overdue Invoice
  const item4 = calculateLineItem(1, dollarsToCents(1800), 0, 0);
  await prisma.invoice.create({
    data: {
      organizationId: acmeOrg.id,
      customerId: customers[0].id,
      invoiceNumber: 'INV-2026-0004',
      status: InvoiceStatus.OVERDUE,
      currency: 'USD',
      subtotalCents: item4.subtotalCents,
      discountCents: BigInt(0),
      taxCents: BigInt(0),
      totalCents: item4.totalCents,
      paidCents: BigInt(0),
      balanceCents: item4.totalCents,
      issueDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
      dueDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // Past due 15 days
      createdByUserId: users.accountant.id,
      items: {
        create: [
          {
            organizationId: acmeOrg.id,
            description: 'Custom API Integrations & Database Tuning',
            quantity: item4.quantity,
            unitPriceCents: item4.unitPriceCents,
            totalCents: item4.totalCents,
          },
        ],
      },
    },
  });

  // 5. Draft Invoice
  const item5 = calculateLineItem(3, dollarsToCents(750), 5, 0);
  await prisma.invoice.create({
    data: {
      organizationId: acmeOrg.id,
      customerId: customers[1].id,
      invoiceNumber: 'INV-2026-0005',
      status: InvoiceStatus.DRAFT,
      currency: 'USD',
      subtotalCents: item5.subtotalCents,
      discountCents: item5.discountCents,
      taxCents: BigInt(0),
      totalCents: item5.totalCents,
      paidCents: BigInt(0),
      balanceCents: item5.totalCents,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdByUserId: users.accountant.id,
      items: {
        create: [
          {
            organizationId: acmeOrg.id,
            description: 'Security penetration testing sprints',
            quantity: item5.quantity,
            unitPriceCents: item5.unitPriceCents,
            discountPercent: item5.discountPercent,
            totalCents: item5.totalCents,
          },
        ],
      },
    },
  });

  console.log('Creating expense reports and approvals...');
  // Expense 1: Approved Travel
  const exp1 = await prisma.expense.create({
    data: {
      organizationId: acmeOrg.id,
      submittedByUserId: users.employee.id,
      vendorId: vendors[1].id,
      category: 'Travel',
      department: 'Engineering',
      project: 'Core Platform v2',
      amountCents: BigInt(84000), // $840.00
      description: 'Flight to Client On-Site Technical Architecture Meeting',
      status: ExpenseStatus.APPROVED,
    },
  });

  await prisma.approvalAction.create({
    data: {
      organizationId: acmeOrg.id,
      expenseId: exp1.id,
      approverUserId: users.financeManager.id,
      action: ApprovalActionType.APPROVED,
      comments: 'Travel approved within Q1 project budget.',
    },
  });

  // Expense 2: Submitted (Pending Approval)
  await prisma.expense.create({
    data: {
      organizationId: acmeOrg.id,
      submittedByUserId: users.employee.id,
      vendorId: vendors[0].id,
      category: 'Software',
      department: 'Engineering',
      project: 'Data Pipelines',
      amountCents: BigInt(125000), // $1,250.00
      description: 'Annual staging environment database compute & storage',
      status: ExpenseStatus.SUBMITTED,
    },
  });

  // Expense 3: Flagged Large Anomaly
  await prisma.expense.create({
    data: {
      organizationId: acmeOrg.id,
      submittedByUserId: users.employee.id,
      vendorId: vendors[2].id,
      category: 'Office Supplies',
      department: 'Operations',
      amountCents: BigInt(380000), // $3,800.00
      description: 'Ergonomic team workstation upgrade package',
      status: ExpenseStatus.SUBMITTED,
      aiFlagged: true,
      aiFlagReason: 'Expense amount exceeds $2,500 threshold, flagged for senior finance review.',
    },
  });

  console.log('Creating initial audit logs...');
  await prisma.auditLog.create({
    data: {
      organizationId: acmeOrg.id,
      userId: users.owner.id,
      action: 'ORGANIZATION_INITIALIZED',
      entityType: 'Organization',
      entityId: acmeOrg.id,
      newState: { name: acmeOrg.name, currency: acmeOrg.currency },
    },
  });

  console.log('✅ Seeding completed successfully!');
  console.log(`
══════════════════════════════════════════════════════════
DEMO ACCOUNTS READY (All passwords: Password123!)
1. Organization Owner:      sarah.cfo@acme.com
2. Finance Manager:         marcus.finance@acme.com
3. Accountant:              elena.accountant@acme.com
4. Employee:                alex.dev@acme.com
5. Auditor (Read-Only):     victor.auditor@auditfirm.com
6. Platform Administrator:  admin@finflow.io
══════════════════════════════════════════════════════════
  `);
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
