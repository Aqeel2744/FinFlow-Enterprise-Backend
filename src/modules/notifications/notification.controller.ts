import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/prisma.js';

export class NotificationController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const notifications = await prisma.notification.findMany({
        where: {
          organizationId: req.organizationId!,
          userId: req.user!.id,
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });

      const unreadCount = await prisma.notification.count({
        where: {
          organizationId: req.organizationId!,
          userId: req.user!.id,
          isRead: false,
        },
      });

      return res.status(200).json({
        success: true,
        data: { notifications, unreadCount },
      });
    } catch (error) {
      next(error);
    }
  }

  static async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      if (id === 'all') {
        await prisma.notification.updateMany({
          where: {
            organizationId: req.organizationId!,
            userId: req.user!.id,
            isRead: false,
          },
          data: { isRead: true },
        });
      } else {
        await prisma.notification.updateMany({
          where: {
            id,
            organizationId: req.organizationId!,
            userId: req.user!.id,
          },
          data: { isRead: true },
        });
      }

      return res.status(200).json({ success: true, message: 'Notification marked as read' });
    } catch (error) {
      next(error);
    }
  }
}
