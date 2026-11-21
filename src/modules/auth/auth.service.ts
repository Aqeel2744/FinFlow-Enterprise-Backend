import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { BadRequestError, UnauthorizedError, ConflictError } from '../../utils/errors.js';
import { resend } from '../../config/resend.js';

export class AuthService {
  static async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    organizationName?: string;
    existingOrganizationId?: string;
    requestedRole?: any;
  }) {
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ConflictError('A user with this email address already exists.');
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(data.password, salt);
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Atomic creation of user and organization membership
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          isVerified: true, // Self-serve onboarding default
          verificationToken,
        },
      });

      let organization = null;

      // Case A: User is joining an existing organization with chosen/assigned role
      if (data.existingOrganizationId) {
        organization = await tx.organization.findUnique({
          where: { id: data.existingOrganizationId },
        });

        if (!organization) {
          throw new BadRequestError('Selected organization does not exist.');
        }

        const role = data.requestedRole || 'EMPLOYEE';

        await tx.membership.create({
          data: {
            userId: user.id,
            organizationId: organization.id,
            role,
            status: 'ACTIVE',
          },
        });
      }
      // Case B: User is registering as an owner and creating a new organization
      else if (data.organizationName) {
        const slug =
          data.organizationName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)+/g, '') +
          '-' +
          crypto.randomBytes(2).toString('hex');

        organization = await tx.organization.create({
          data: {
            name: data.organizationName,
            slug,
            currency: 'USD',
          },
        });

        await tx.membership.create({
          data: {
            userId: user.id,
            organizationId: organization.id,
            role: 'ORG_OWNER',
            status: 'ACTIVE',
          },
        });

        // Initialize default approval policy
        await tx.approvalPolicy.create({
          data: {
            organizationId: organization.id,
            name: 'Standard Financial Approvals',
            minAmountCents: BigInt(50000), // $500+ requires approval
            requiredRole: 'FINANCE_MANAGER',
            autoApproveBelowCents: BigInt(50000),
          },
        });
      }

      return { user, organization };
    });

    const tokens = this.generateTokens({
      userId: result.user.id,
      email: result.user.email,
    });

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
      },
      organization: result.organization,
      tokens,
    };
  }

  static async login(data: { email: string; password: string; mfaCode?: string }) {
    const user = await prisma.user.findUnique({
      where: { email: data.email },
      include: {
        memberships: {
          include: { organization: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(data.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Optional MFA check
    if (user.mfaEnabled) {
      if (!data.mfaCode) {
        return {
          mfaRequired: true,
          userId: user.id,
        };
      }
      if (data.mfaCode !== '123456') { // Mock/TOTP token check
        throw new UnauthorizedError('Invalid two-factor authentication code');
      }
    }

    const tokens = this.generateTokens({
      userId: user.id,
      email: user.email,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        mfaEnabled: user.mfaEnabled,
      },
      organizations: user.memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        currency: m.organization.currency,
        role: m.role,
        status: m.status,
      })),
      tokens,
    };
  }

  static async refreshToken(refreshToken: string) {
    try {
      const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as {
        userId: string;
        email: string;
      };

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user) {
        throw new UnauthorizedError('User account not found');
      }

      return this.generateTokens({
        userId: user.id,
        email: user.email,
      });
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }
  }

  static async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          include: { organization: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isVerified: user.isVerified,
      mfaEnabled: user.mfaEnabled,
      avatarUrl: user.avatarUrl,
      organizations: user.memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        currency: m.organization.currency,
        role: m.role,
        status: m.status,
      })),
    };
  }

  static async forgotPassword(email: string, appUrl: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Don't leak user existence
      return { message: 'If an account exists, a reset link has been dispatched.' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpires },
    });

    if (resend) {
      try {
        await resend.emails.send({
          from: env.EMAIL_FROM,
          to: user.email,
          subject: 'FinFlow — Reset Your Password',
          html: `<p>Hello ${user.firstName},</p>
          <p>You requested a password reset for your FinFlow account. Click below to choose a new password:</p>
          <p><a href="${appUrl}/reset-password?token=${resetToken}">Reset Password</a></p>
          <p>This link expires in 60 minutes.</p>`,
        });
      } catch (err: any) {
        console.warn('Failed to send reset email via Resend:', err.message);
      }
    }

    return {
      message: 'If an account exists, a reset link has been dispatched.',
      debugToken: process.env.NODE_ENV !== 'production' ? resetToken : undefined,
    };
  }

  static async resetPassword(token: string, newPass: string) {
    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpires: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestError('Invalid or expired password reset token');
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(newPass, salt);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpires: null,
      },
    });

    return { message: 'Password has been updated successfully. You can now login.' };
  }

  private static generateTokens(payload: { userId: string; email: string }) {
    const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN as any,
    });
    const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN as any,
    });

    return { accessToken, refreshToken };
  }
}
