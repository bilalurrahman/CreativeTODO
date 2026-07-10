import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DashboardResponse, TodoTask, UpsertTaskRequest } from './todo.models';

@Injectable({ providedIn: 'root' })
export class TodoApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api';

  getDashboard(date: string) {
    return this.http.get<DashboardResponse>(`${this.baseUrl}/dashboard`, {
      params: { date }
    });
  }

  createTask(request: UpsertTaskRequest) {
    return this.http.post<TodoTask>(`${this.baseUrl}/tasks`, request);
  }

  updateTask(id: number, request: UpsertTaskRequest) {
    return this.http.put<TodoTask>(`${this.baseUrl}/tasks/${id}`, request);
  }

  deleteTask(id: number) {
    return this.http.delete<void>(`${this.baseUrl}/tasks/${id}`);
  }
}
