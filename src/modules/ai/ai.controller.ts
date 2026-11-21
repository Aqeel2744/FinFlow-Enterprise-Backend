
import { Request, Response, NextFunction } from 'express';
import { AiService } from './ai.service.js';

export class AiController {

  static async suggestCategory(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { description, amount } = req.body || {};

      if (typeof description !== 'string' || !description.trim()) {
        return res.status(400).json({
          success: false,
          message: 'A valid expense description is required.',
        });
      }

      if (
        amount !== undefined &&
        (
          typeof amount !== 'number' ||
          !Number.isFinite(amount) ||
          amount < 0
        )
      ) {
        return res.status(400).json({
          success: false,
          message: 'Amount must be a valid non-negative number.',
        });
      }

      const result = await AiService.suggestCategory(
        description,
        amount
      );

      return res.status(200).json({
        success: true,
        data: result,
      });

    } catch (error) {
      next(error);
    }
  }

  static async getExecutiveInsights(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const organizationId = req.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context is required.',
        });
      }

      const insights =
        await AiService.generateExecutiveFinancialInsights(
          organizationId
        );

      return res.status(200).json({
        success: true,
        data: insights,
      });

    } catch (error) {
      next(error);
    }
  }

  static async detectAnomalies(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const organizationId = req.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context is required.',
        });
      }

      const anomalies =
        await AiService.detectAnomalies(organizationId);

      return res.status(200).json({
        success: true,
        data: anomalies,
      });

    } catch (error) {
      next(error);
    }
  }
}
