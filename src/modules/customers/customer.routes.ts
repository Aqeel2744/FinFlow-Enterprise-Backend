import { Router } from 'express';
import { CustomerController } from './customer.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireTenant } from '../../middlewares/tenant.middleware.js';
import { allowAccountingStaff, allowAllMembers } from '../../middlewares/rbac.middleware.js';
import { cachedJsonResponse, invalidateOrganizationCacheResponse } from '../../utils/cache.js';

const router = Router();

router.use(requireAuth, requireTenant);

router.get('/', allowAllMembers, cachedJsonResponse(60), CustomerController.list);
router.get('/:id', allowAllMembers, cachedJsonResponse(60), CustomerController.getById);
router.post('/', allowAccountingStaff, invalidateOrganizationCacheResponse(), CustomerController.create);
router.patch('/:id', allowAccountingStaff, invalidateOrganizationCacheResponse(), CustomerController.update);
router.delete('/:id', allowAccountingStaff, invalidateOrganizationCacheResponse(), CustomerController.delete);

export { router as customerRoutes };
