import { Router } from 'express';
import { VendorController } from './vendor.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireTenant } from '../../middlewares/tenant.middleware.js';
import { allowAccountingStaff, allowAllMembers } from '../../middlewares/rbac.middleware.js';
import { cachedJsonResponse, invalidateOrganizationCacheResponse } from '../../utils/cache.js';

const router = Router();

router.use(requireAuth, requireTenant);

router.get('/', allowAllMembers, cachedJsonResponse(60), VendorController.list);
router.get('/:id', allowAllMembers, cachedJsonResponse(60), VendorController.getById);
router.post('/', allowAccountingStaff, invalidateOrganizationCacheResponse(), VendorController.create);
router.patch('/:id', allowAccountingStaff, invalidateOrganizationCacheResponse(), VendorController.update);
router.delete('/:id', allowAccountingStaff, invalidateOrganizationCacheResponse(), VendorController.delete);

export { router as vendorRoutes };
