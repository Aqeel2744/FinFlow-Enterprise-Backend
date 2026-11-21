import { Router } from 'express';
import { PaymentController } from './payment.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireTenant } from '../../middlewares/tenant.middleware.js';
import { allowAccountingStaff, allowAllMembers } from '../../middlewares/rbac.middleware.js';
import { idempotency } from '../../middlewares/idempotency.middleware.js';
import { cachedJsonResponse, invalidateOrganizationCacheResponse } from '../../utils/cache.js';

const router = Router();

router.use(requireAuth, requireTenant);

router.get('/', allowAllMembers, cachedJsonResponse(60), PaymentController.list);

// Record payment with Idempotency protection to prevent duplicate charges/records
router.post('/', allowAccountingStaff, idempotency(), invalidateOrganizationCacheResponse(), PaymentController.record);

export { router as paymentRoutes };
