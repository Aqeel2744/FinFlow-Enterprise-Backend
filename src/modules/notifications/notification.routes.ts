import { Router } from 'express';
import { NotificationController } from './notification.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireTenant } from '../../middlewares/tenant.middleware.js';
import { cachedJsonResponse, invalidateOrganizationCacheResponse } from '../../utils/cache.js';

const router = Router();

router.use(requireAuth, requireTenant);

router.get('/', cachedJsonResponse(30), NotificationController.list);
router.patch('/:id/read', invalidateOrganizationCacheResponse(), NotificationController.markAsRead);

export { router as notificationRoutes };
