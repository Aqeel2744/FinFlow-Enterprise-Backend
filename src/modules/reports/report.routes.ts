import { Router } from 'express';
import { ReportController } from './report.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireTenant } from '../../middlewares/tenant.middleware.js';
import { allowAllMembers, allowAccountingStaff } from '../../middlewares/rbac.middleware.js';
import { cachedJsonResponse } from '../../utils/cache.js';

const router = Router();

router.use(requireAuth, requireTenant);

router.get('/summary', allowAllMembers, cachedJsonResponse(60), ReportController.getSummary);
router.get('/trends', allowAllMembers, cachedJsonResponse(60), ReportController.getTrends);
router.get('/ar-aging', allowAllMembers, cachedJsonResponse(60), ReportController.getArAging);
router.get('/expenses-breakdown', allowAllMembers, cachedJsonResponse(60), ReportController.getExpenseBreakdown);
router.get('/export/:type', allowAccountingStaff, ReportController.exportCsv);

export { router as reportRoutes };
