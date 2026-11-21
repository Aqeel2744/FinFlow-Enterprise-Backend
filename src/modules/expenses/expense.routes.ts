import { Router } from 'express';
import { ExpenseController } from './expense.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireTenant } from '../../middlewares/tenant.middleware.js';
import { allowAllMembers } from '../../middlewares/rbac.middleware.js';
import { uploadReceipt } from '../../middlewares/upload.middleware.js';
import { cachedJsonResponse, invalidateOrganizationCacheResponse } from '../../utils/cache.js';

const router = Router();

router.use(requireAuth, requireTenant);

router.get('/', allowAllMembers, cachedJsonResponse(60), ExpenseController.list);
router.get('/:id', allowAllMembers, cachedJsonResponse(60), ExpenseController.getById);

// Submit expense with optional receipt attachment
router.post('/', allowAllMembers, uploadReceipt.single('receipt'), invalidateOrganizationCacheResponse(), ExpenseController.submit);
router.patch('/:id', allowAllMembers, invalidateOrganizationCacheResponse(), ExpenseController.update);
router.delete('/:id', allowAllMembers, invalidateOrganizationCacheResponse(), ExpenseController.delete);

export { router as expenseRoutes };
