import { Request, Response, NextFunction } from 'express';
import { ReportService } from './report.service.js';

export class ReportController {
  static async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate } = req.query;
      const summary = await ReportService.getDashboardSummary(req.organizationId!, {
        startDate: startDate as string,
        endDate: endDate as string,
      });
      return res.status(200).json({ success: true, data: summary });
    } catch (error) {
      next(error);
    }
  }

  static async getTrends(req: Request, res: Response, next: NextFunction) {
    try {
      const trends = await ReportService.getMonthlyTrends(req.organizationId!);
      return res.status(200).json({ success: true, data: trends });
    } catch (error) {
      next(error);
    }
  }

  static async getArAging(req: Request, res: Response, next: NextFunction) {
    try {
      const arAging = await ReportService.getAccountsReceivableAging(req.organizationId!);
      return res.status(200).json({ success: true, data: arAging });
    } catch (error) {
      next(error);
    }
  }

  static async getExpenseBreakdown(req: Request, res: Response, next: NextFunction) {
    try {
      const breakdown = await ReportService.getExpenseBreakdown(req.organizationId!);
      return res.status(200).json({ success: true, data: breakdown });
    } catch (error) {
      next(error);
    }
  }

  static async exportCsv(req: Request, res: Response, next: NextFunction) {
    try {
      const type = (req.params.type || 'invoices') as 'invoices' | 'payments' | 'expenses';
      const csvData = await ReportService.exportCsv(req.organizationId!, type);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-export-${Date.now()}.csv"`);
      return res.send(csvData);
    } catch (error) {
      next(error);
    }
  }
}
