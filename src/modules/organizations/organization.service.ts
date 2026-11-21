import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma.js';
import { Role } from '@prisma/client';
import { BadRequestError, NotFoundError, ForbiddenError, ConflictError } from '../../utils/errors.js';
import { AuditService } from '../audit/audit.service.js';
import {
  authUserCacheKey,
  CACHE_TTL_SECONDS,
  deleteCached,
  getCached,
  organizationsCacheKey,
  setCached,
} from '../../utils/cache.js';

export class OrganizationService {
  private static async invalidateOrganizationUsers(organizationId: string) {
    const memberships = await prisma.membership.findMany({
      where: { organizationId },
      select: { userId: true },
    });

    await deleteCached(
      ...memberships.map((membership) => organizationsCacheKey(membership.userId))
    );
  }

  static async listUserOrganizations(userId: string) {
    const cacheKey = organizationsCacheKey(userId);
    const cached = await getCached(cacheKey);
    if (cached) return cached;

    const memberships = await prisma.membership.findMany({
      where: { userId },
      include: {
        organization: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    await setCached(cacheKey, memberships, CACHE_TTL_SECONDS.organizations);
    return memberships;
  }

  static async createOrganization(userId: string, data: { name: string; currency?: string; timezone?: string }) {
    const slug =
      data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '') +
      '-' +
      crypto.randomBytes(2).toString('hex');

    const org = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: data.name,
          slug,
          currency: data.currency || 'USD',
          timezone: data.timezone || 'UTC',
        },
      });

      await tx.membership.create({
        data: {
          userId,
          organizationId: organization.id,
          role: Role.ORG_OWNER,
          status: 'ACTIVE',
        },
      });

      // Default approval policy
      await tx.approvalPolicy.create({
        data: {
          organizationId: organization.id,
          name: 'Executive & Finance Approvals',
          minAmountCents: BigInt(50000), // $500 threshold
          requiredRole: Role.FINANCE_MANAGER,
          autoApproveBelowCents: BigInt(50000),
        },
      });

      return organization;
    });

    await AuditService.log({
      organizationId: org.id,
      userId,
      action: 'ORGANIZATION_CREATED',
      entityType: 'Organization',
      entityId: org.id,
      newState: { name: org.name, slug: org.slug },
    });

    await deleteCached(organizationsCacheKey(userId));

    return org;
  }

  static async updateOrganization(
    organizationId: string,
    userId: string,
    data: { name?: string; currency?: string; timezone?: string; taxId?: string; address?: string; phone?: string }
  ) {
    const existing = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!existing) throw new NotFoundError('Organization not found');

    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data,
    });

    await AuditService.log({
      organizationId,
      userId,
      action: 'ORGANIZATION_UPDATED',
      entityType: 'Organization',
      entityId: organizationId,
      oldState: existing,
      newState: updated,
    });

    await this.invalidateOrganizationUsers(organizationId);

    return updated;
  }

  static async getMembers(organizationId: string) {
    return prisma.membership.findMany({
      where: { organizationId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  static async inviteMember(
    organizationId: string,
    inviterUserId: string,
    data: { email: string; role: Role }
  ) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundError('Organization not found');

    const email = data.email.trim().toLowerCase();
    const { membership, temporaryPassword } = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email } });
      const existingMembership = user
        ? await tx.membership.findUnique({
            where: {
              userId_organizationId: {
                userId: user.id,
                organizationId,
              },
            },
          })
        : null;

      if (existingMembership && existingMembership.status !== 'INVITED') {
        throw new ConflictError('User is already a member of this organization');
      }

      let temporaryPassword: string | undefined;
      if (!user || !user.passwordHash) {
        temporaryPassword = crypto.randomBytes(24).toString('base64url');
        const passwordHash = await bcrypt.hash(temporaryPassword, await bcrypt.genSalt(12));

        user = user
          ? await tx.user.update({
              where: { id: user.id },
              data: { passwordHash, isVerified: true },
            })
          : await tx.user.create({
              data: {
                email,
                passwordHash,
                firstName: 'Invited',
                lastName: 'Member',
                isVerified: true,
              },
            });
      }

      if (!user) {
        throw new Error('Failed to create or locate the invited user.');
      }

      const membership = existingMembership
        ? await tx.membership.update({
            where: { id: existingMembership.id },
            data: {
              role: data.role,
              status: 'ACTIVE',
              inviteToken: null,
              invitedEmail: null,
            },
          })
        : await tx.membership.create({
            data: {
              userId: user.id,
              organizationId,
              role: data.role,
              status: 'ACTIVE',
            },
          });

      return { membership, temporaryPassword };
    });

    await AuditService.log({
      organizationId,
      userId: inviterUserId,
      action: 'MEMBER_INVITED',
      entityType: 'Membership',
      entityId: membership.id,
      newState: { email, role: data.role },
    });

    await this.invalidateOrganizationUsers(organizationId);

    return {
      membership,
      temporaryPassword,
    };
  }

  static async acceptInvite(token: string, userId: string) {
    const membership = await prisma.membership.findFirst({
      where: { inviteToken: token, status: 'INVITED' },
      include: { organization: true },
    });

    if (!membership) {
      throw new BadRequestError('Invalid or expired invitation token');
    }

    // Re-link to the accepting user if needed
    const updated = await prisma.membership.update({
      where: { id: membership.id },
      data: {
        userId,
        status: 'ACTIVE',
        inviteToken: null,
      },
    });

    await AuditService.log({
      organizationId: membership.organizationId,
      userId,
      action: 'INVITE_ACCEPTED',
      entityType: 'Membership',
      entityId: membership.id,
    });

    await deleteCached(
      organizationsCacheKey(userId),
      authUserCacheKey(userId)
    );

    return updated;
  }

  static async updateMemberRole(organizationId: string, actorUserId: string, targetMembershipId: string, newRole: Role) {
    const target = await prisma.membership.findUnique({
      where: { id: targetMembershipId },
    });

    if (!target || target.organizationId !== organizationId) {
      throw new NotFoundError('Team member not found in this organization');
    }

    // Guard: Prevent demoting the last ORG_OWNER
    if (target.role === Role.ORG_OWNER && newRole !== Role.ORG_OWNER) {
      const ownerCount = await prisma.membership.count({
        where: { organizationId, role: Role.ORG_OWNER, status: 'ACTIVE' },
      });
      if (ownerCount <= 1) {
        throw new BadRequestError('Cannot demote the only remaining Organization Owner.');
      }
    }

    const updated = await prisma.membership.update({
      where: { id: targetMembershipId },
      data: { role: newRole },
    });

    await AuditService.log({
      organizationId,
      userId: actorUserId,
      action: 'MEMBER_ROLE_UPDATED',
      entityType: 'Membership',
      entityId: targetMembershipId,
      oldState: { role: target.role },
      newState: { role: newRole },
    });

    await this.invalidateOrganizationUsers(organizationId);

    return updated;
  }

  static async removeMember(organizationId: string, actorUserId: string, targetMembershipId: string) {
    const target = await prisma.membership.findUnique({
      where: { id: targetMembershipId },
    });

    if (!target || target.organizationId !== organizationId) {
      throw new NotFoundError('Member not found');
    }

    if (target.role === Role.ORG_OWNER) {
      const ownerCount = await prisma.membership.count({
        where: { organizationId, role: Role.ORG_OWNER, status: 'ACTIVE' },
      });
      if (ownerCount <= 1) {
        throw new BadRequestError('Cannot remove the only Organization Owner.');
      }
    }

    await prisma.membership.delete({
      where: { id: targetMembershipId },
    });

    await AuditService.log({
      organizationId,
      userId: actorUserId,
      action: 'MEMBER_REMOVED',
      entityType: 'Membership',
      entityId: targetMembershipId,
      oldState: target,
    });

    await this.invalidateOrganizationUsers(organizationId);

    return { message: 'Member removed successfully' };
  }

  static async listPublicOrganizations() {
    return prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        currency: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  static async provisionMember(
    organizationId: string,
    actorUserId: string,
    data: {
      firstName: string;
      lastName: string;
      email: string;
      role: Role;
      password?: string;
    }
  ) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundError('Organization not found');

    const cleanEmail = data.email.toLowerCase().trim();
    const initialPassword = data.password && data.password.trim().length >= 6 ? data.password.trim() : 'Password123!';

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(initialPassword, salt);

    let user = await prisma.user.findUnique({ where: { email: cleanEmail } });

    if (user) {
      // Check existing membership
      const existingMembership = await prisma.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId,
          },
        },
      });

      if (existingMembership) {
        throw new ConflictError('User is already a member of this organization');
      }

      // Update password if they were a placeholder invitee
      if (!user.passwordHash || user.passwordHash === '') {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            passwordHash,
            firstName: data.firstName.trim() || user.firstName,
            lastName: data.lastName.trim() || user.lastName,
            isVerified: true,
          },
        });
      }
    } else {
      user = await prisma.user.create({
        data: {
          email: cleanEmail,
          passwordHash,
          firstName: data.firstName.trim(),
          lastName: data.lastName.trim(),
          isVerified: true,
        },
      });
    }

    const membership = await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId,
        role: data.role,
        status: 'ACTIVE',
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    await AuditService.log({
      organizationId,
      userId: actorUserId,
      action: 'MEMBER_PROVISIONED',
      entityType: 'Membership',
      entityId: membership.id,
      newState: { email: cleanEmail, role: data.role },
    });

    await deleteCached(
      organizationsCacheKey(user.id),
      authUserCacheKey(user.id)
    );
    await this.invalidateOrganizationUsers(organizationId);

    return {
      membership,
      credentials: {
        email: cleanEmail,
        password: initialPassword,
        role: data.role,
        organizationName: org.name,
      },
    };
  }

  static async resetMemberPassword(
    organizationId: string,
    actorUserId: string,
    targetMembershipId: string,
    newPassword?: string
  ) {
    const membership = await prisma.membership.findUnique({
      where: { id: targetMembershipId },
      include: { user: true },
    });

    if (!membership || membership.organizationId !== organizationId) {
      throw new NotFoundError('Member not found in this organization');
    }

    const finalPassword = newPassword?.trim() || crypto.randomBytes(24).toString('base64url');
    const passwordHash = await bcrypt.hash(finalPassword, await bcrypt.genSalt(12));

    await prisma.user.update({
      where: { id: membership.userId },
      data: { passwordHash },
    });

    await AuditService.log({
      organizationId,
      userId: actorUserId,
      action: 'MEMBER_PASSWORD_RESET_BY_ADMIN',
      entityType: 'Membership',
      entityId: targetMembershipId,
      newState: { userEmail: membership.user.email },
    });

    await deleteCached(authUserCacheKey(membership.userId));

    return {
      message: `Password has been reset for ${membership.user.email}. Hand the new password to your employee.`,
      email: membership.user.email,
      newPassword: finalPassword,
    };
  }
}
