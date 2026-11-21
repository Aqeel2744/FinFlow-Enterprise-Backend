
import { Router } from 'express';

import { AiController } from './ai.controller.js';

import { requireAuth } from '../../middlewares/auth.middleware.js';
import { requireTenant } from '../../middlewares/tenant.middleware.js';

import {
  allowAllMembers,
  allowOwnersAndFinance,
} from '../../middlewares/rbac.middleware.js';

const router = Router();

// Authentication and organization isolation
router.use(requireAuth, requireTenant);

// Expense categorization
router.post(
  '/suggest-category',
  allowAllMembers,
  AiController.suggestCategory
);

// Executive financial intelligence
router.get(
  '/insights',
  allowOwnersAndFinance,
  AiController.getExecutiveInsights
);

// Expense anomaly detection
router.get(
  '/anomalies',
  allowOwnersAndFinance,
  AiController.detectAnomalies
);

export { router as aiRoutes };
