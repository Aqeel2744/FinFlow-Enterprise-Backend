import { Router, Request, Response, NextFunction } from 'express';
import { AuditService } from './audit.service.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireTenant } from '../../middlewares/tenant.middleware.js';
import { allowOwnersAndFinance } from '../../middlewares/rbac.middleware.js';
import { cachedJsonResponse } from '../../utils/cache.js';

const router = Router();

router.use(requireAuth, requireTenant, allowOwnersAndFinance);

router.get('/', cachedJsonResponse(60), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { entityType, entityId, limit } = req.query;
    const logs = await AuditService.listLogs(req.organizationId!, {
      entityType: entityType as string,
      entityId: entityId as string,
      limit: limit ? parseInt(limit as string) : 50,
    });
    return res.status(200).json({ success: true, data: logs });
  } catch (error) {
    next(error);
  }
});

export { router as auditRoutes };
