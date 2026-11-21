import { Router } from 'express';
import { OrganizationController } from './organization.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireTenant } from '../../middlewares/tenant.middleware.js';
import { requireRole } from '../../middlewares/rbac.middleware.js';
import { Role } from '@prisma/client';
import { cachedJsonResponse, invalidateOrganizationCacheResponse } from '../../utils/cache.js';

const router = Router();

// Public organization listing for registration onboarding
router.get('/public-list', OrganizationController.listPublic);

// User org lists and creation (auth only, no tenant context needed yet)
router.get('/', requireAuth, cachedJsonResponse(120), OrganizationController.listUserOrganizations);
router.post('/', requireAuth, invalidateOrganizationCacheResponse(), OrganizationController.createOrganization);
router.post('/accept-invite', requireAuth, invalidateOrganizationCacheResponse(), OrganizationController.acceptInvite);

// Organization-scoped endpoints
router.patch('/current', requireAuth, requireTenant, invalidateOrganizationCacheResponse(), requireRole([Role.ORG_OWNER]), OrganizationController.updateOrganization);
router.get('/members', requireAuth, requireTenant, cachedJsonResponse(60), OrganizationController.getMembers);
router.post('/members/invite', requireAuth, requireTenant, invalidateOrganizationCacheResponse(), requireRole([Role.ORG_OWNER, Role.FINANCE_MANAGER]), OrganizationController.inviteMember);
router.post('/members/provision', requireAuth, requireTenant, invalidateOrganizationCacheResponse(), requireRole([Role.ORG_OWNER, Role.FINANCE_MANAGER]), OrganizationController.provisionMember);
router.post('/members/:memberId/reset-password', requireAuth, requireTenant, invalidateOrganizationCacheResponse(), requireRole([Role.ORG_OWNER, Role.FINANCE_MANAGER]), OrganizationController.resetMemberPassword);
router.patch('/members/:memberId/role', requireAuth, requireTenant, invalidateOrganizationCacheResponse(), requireRole([Role.ORG_OWNER]), OrganizationController.updateMemberRole);
router.delete('/members/:memberId', requireAuth, requireTenant, invalidateOrganizationCacheResponse(), requireRole([Role.ORG_OWNER]), OrganizationController.removeMember);

export { router as organizationRoutes };
