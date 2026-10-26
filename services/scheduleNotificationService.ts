import { NotificationService } from './notificationService';

export interface ScheduleData {
  id: string;
  userId: string;
  dateText: string; // e.g., "August 17, 2025"
  timeText: string; // e.g., "07:00"
  street: string;
  frequency: string; // One-time | Daily | Weekly | Monthly
  wasteCategory: string;
  truck?: string;
  driver?: string;
  note?: string;
}

export class ScheduleNotificationService {
  static async schedulePickupNotifications(schedules: ScheduleData[]) {
    const now = new Date();
    
    for (const schedule of schedules) {
      try {
        // Parse the date from dateText (e.g., "August 17, 2025")
        const scheduleDate = this.parseScheduleDate(schedule.dateText);
        if (!scheduleDate) continue;

        // Set the time
        const [hours, minutes] = schedule.timeText.split(':').map(Number);
        scheduleDate.setHours(hours, minutes, 0, 0);

        // Only schedule notifications for future pickups
        if (scheduleDate > now) {
          await NotificationService.schedulePickupReminder({
            id: schedule.id,
            date: scheduleDate,
            time: schedule.timeText,
            type: schedule.wasteCategory
          });
        }
      } catch (error) {
        console.error(`Error scheduling notification for schedule ${schedule.id}:`, error);
      }
    }
  }

  static parseScheduleDate(dateText?: string): Date | null {
    try {
      if (!dateText || typeof dateText !== 'string') {
        return null;
      }

      // Clean up the input
      const cleanText = dateText.trim();
      if (!cleanText) return null;
      
      // Parse dateText like "August 17, 2025" or "September 22, 2025"
      const date = new Date(cleanText);
      if (isNaN(date.getTime())) {
        // Try manual parsing for US long format
        const match = cleanText.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
        if (match) {
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
          const monthIndex = monthNames.findIndex(m => m.toLowerCase() === match[1].toLowerCase());
          
          if (monthIndex !== -1) {
            const manualDate = new Date(parseInt(match[3]), monthIndex, parseInt(match[2]));
            if (!isNaN(manualDate.getTime())) {
              return manualDate;
            }
          }
        }
        return null;
      }
      return date;
    } catch {
      return null;
    }
  }

  static async cancelScheduleNotifications(scheduleIds: string[]) {
    try {
      const scheduledNotifications = await NotificationService.getScheduledNotifications();
      
      for (const notification of scheduledNotifications) {
        const data = notification.content.data as Record<string, any> | undefined;
        const scheduleId = data?.scheduleId ? String(data.scheduleId) : null;
        if (scheduleId && scheduleIds.includes(scheduleId)) {
          await NotificationService.cancelNotification(notification.identifier);
        }
      }
    } catch (error) {
      console.error('Error canceling schedule notifications:', error);
    }
  }

  static async upsertScheduleNotifications(schedule: ScheduleData & { specificSchedules?: any[] }) {
    try {
      if (Array.isArray(schedule.specificSchedules) && schedule.specificSchedules.length > 0) {
        for (const item of schedule.specificSchedules) {
          const date = this.parseScheduleDate(item.dateText || item.date);
          if (date) {
            await NotificationService.upsertPickupReminders({
              id: `${schedule.id}_${item.dateText || item.date}`,
              date,
              time: item.timeText || schedule.timeText,
              type: item.wasteCategory || schedule.wasteCategory,
            });
          }
        }
        return;
      }

      const date = this.parseScheduleDate(schedule.dateText);
      if (!date) return;
      await NotificationService.upsertPickupReminders({
        id: schedule.id,
        date,
        time: schedule.timeText,
        type: schedule.wasteCategory,
      });
    } catch (e) {
      console.error('Upsert schedule notifications error:', e);
    }
  }

  static async rescheduleAllNotifications(schedules: ScheduleData[]) {
    // Cancel all existing schedule notifications
    await NotificationService.cancelAllNotifications();
    // Upsert notifications per schedule to avoid duplicates on iOS
    for (const s of schedules) {
      await this.upsertScheduleNotifications(s);
    }
  }
}
