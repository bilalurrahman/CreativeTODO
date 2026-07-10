export type TaskCategory = 'Ritual' | 'Focus' | 'Recharge' | 'Admin';

export interface TodoTask {
  id: number;
  title: string;
  notes: string | null;
  category: TaskCategory;
  accentColor: string;
  scheduledDate: string;
  startMinutes: number;
  durationMinutes: number;
  energy: number;
  isCompleted: boolean;
}

export interface DayMetrics {
  focusMinutes: number;
  ritualMinutes: number;
  rechargeMinutes: number;
  completionRate: number;
}

export interface DashboardResponse {
  selectedDate: string;
  tasks: TodoTask[];
  metrics: DayMetrics;
  insights: string[];
}

export interface UpsertTaskRequest {
  title: string;
  notes: string | null;
  category: TaskCategory;
  accentColor: string;
  scheduledDate: string;
  startMinutes: number;
  durationMinutes: number;
  energy: number;
  isCompleted: boolean;
}
