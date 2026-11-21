import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('Valid email is required').toLowerCase().trim(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required').trim(),
  lastName: z.string().min(1, 'Last name is required').trim(),
  organizationName: z.string().min(2, 'Organization name is required').trim().optional(),
  existingOrganizationId: z.string().uuid().optional(),
  requestedRole: z.enum(['EMPLOYEE', 'ACCOUNTANT', 'FINANCE_MANAGER', 'AUDITOR', 'ORG_OWNER']).default('EMPLOYEE').optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Valid email is required').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
  mfaCode: z.string().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Valid email is required').toLowerCase().trim(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export const verifyMfaSchema = z.object({
  code: z.string().min(6, '6-digit code required').max(6),
});
