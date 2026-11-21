import { Request, Response, NextFunction } from 'express';
import { OrganizationService } from './organization.service.js';
import { Role } from '@prisma/client';
import { z } from 'zod';

const createOrgSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').trim(),
  currency: z.string().length(3).default('USD'),
  timezone: z.string().default('UTC'),
});

const updateOrgSchema = z.object({
  name: z.string().min(2).optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().optional(),
  taxId: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
});

const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(Role),
});

const resetMemberPasswordSchema = z.object({
  newPassword: z.string().min(8).optional(),
});

export class OrganizationController {
  static async listUserOrganizations(req: Request, res: Response, next: NextFunction) {
    try {
      const memberships = await OrganizationService.listUserOrganizations(req.user!.id);
      return res.status(200).json({ success: true, data: memberships });
    } catch (error) {
      next(error);
    }
  }

  static async createOrganization(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = createOrgSchema.parse(req.body);
      const org = await OrganizationService.createOrganization(req.user!.id, validated);
      return res.status(201).json({ success: true, data: org });
    } catch (error) {
      next(error);
    }
  }

  static async updateOrganization(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = updateOrgSchema.parse(req.body);
      const updated = await OrganizationService.updateOrganization(req.organizationId!, req.user!.id, validated);
      return res.status(200).json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }

  static async getMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const members = await OrganizationService.getMembers(req.organizationId!);
      return res.status(200).json({ success: true, data: members });
    } catch (error) {
      next(error);
    }
  }

  static async inviteMember(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = inviteMemberSchema.parse(req.body);
      const result = await OrganizationService.inviteMember(req.organizationId!, req.user!.id, validated);
      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  static async acceptInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.body.token || req.query.token;
      const result = await OrganizationService.acceptInvite(token as string, req.user!.id);
      return res.status(200).json({ success: true, message: 'Invitation accepted successfully', data: result });
    } catch (error) {
      next(error);
    }
  }

  static async updateMemberRole(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = req.body;
      const result = await OrganizationService.updateMemberRole(
        req.organizationId!,
        req.user!.id,
        req.params.memberId,
        role
      );
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  static async removeMember(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await OrganizationService.removeMember(
        req.organizationId!,
        req.user!.id,
        req.params.memberId
      );
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  static async listPublic(req: Request, res: Response, next: NextFunction) {
    try {
      const orgs = await OrganizationService.listPublicOrganizations();
      return res.status(200).json({ success: true, data: orgs });
    } catch (error) {
      next(error);
    }
  }

  static async provisionMember(req: Request, res: Response, next: NextFunction) {
    try {
      const { firstName, lastName, email, role, password } = req.body;
      const result = await OrganizationService.provisionMember(
        req.organizationId!,
        req.user!.id,
        {
          firstName: firstName || 'Staff',
          lastName: lastName || 'Member',
          email,
          role,
          password,
        }
      );
      return res.status(201).json({
        success: true,
        message: 'Team member account created and credentials provisioned successfully.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async resetMemberPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { newPassword } = resetMemberPasswordSchema.parse(req.body || {});
      const result = await OrganizationService.resetMemberPassword(
        req.organizationId!,
        req.user!.id,
        req.params.memberId,
        newPassword
      );
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
}
