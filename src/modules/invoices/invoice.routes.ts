import { Router } from 'express';
import { InvoiceController } from './invoice.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireTenant } from '../../middlewares/tenant.middleware.js';
import { allowAccountingStaff, allowAllMembers } from '../../middlewares/rbac.middleware.js';
import { cachedJsonResponse, invalidateOrganizationCacheResponse } from '../../utils/cache.js';

const router = Router();

router.use(requireAuth, requireTenant);

router.get('/', allowAllMembers, cachedJsonResponse(60), InvoiceController.list);
router.get('/:id', allowAllMembers, cachedJsonResponse(60), InvoiceController.getById);
router.get('/:id/pdf', allowAllMembers, InvoiceController.downloadPdf);
router.post('/', allowAccountingStaff, invalidateOrganizationCacheResponse(), InvoiceController.create);
router.patch('/:id', allowAccountingStaff, invalidateOrganizationCacheResponse(), InvoiceController.updateDraft);
router.post('/:id/issue', allowAccountingStaff, invalidateOrganizationCacheResponse(), InvoiceController.issue);
router.post('/:id/cancel', allowAccountingStaff, invalidateOrganizationCacheResponse(), InvoiceController.cancel);
router.delete('/:id', allowAccountingStaff, invalidateOrganizationCacheResponse(), InvoiceController.delete);

export { router as invoiceRoutes };
