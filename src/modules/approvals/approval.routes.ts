import { Router } from 'express';
import { ApprovalController } from './approval.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireTenant } from '../../middlewares/tenant.middleware.js';
import { allowOwnersAndFinance } from '../../middlewares/rbac.middleware.js';
import { cachedJsonResponse, invalidateOrganizationCacheResponse } from '../../utils/cache.js';

const router = Router();

router.use(requireAuth, requireTenant);

// Only Organization Owners and Finance Managers can access approval workflows
router.get('/pending', allowOwnersAndFinance, cachedJsonResponse(30), ApprovalController.listPending);
router.post('/:expenseId/decide', allowOwnersAndFinance, invalidateOrganizationCacheResponse(), ApprovalController.decide);

export { router as approvalRoutes };
