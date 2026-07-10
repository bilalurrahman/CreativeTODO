import { CommonModule, DatePipe } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import * as THREE from 'three';
import { TodoApiService } from './todo-api.service';
import { DashboardResponse, TaskCategory, TodoTask, UpsertTaskRequest } from './todo.models';

interface TaskFormValue {
  id: number | null;
  title: string;
  notes: string;
  category: TaskCategory;
  accentColor: string;
  scheduledDate: string;
  startTime: string;
  durationMinutes: number;
  energy: number;
  isCompleted: boolean;
}

interface RingSegment {
  task: TodoTask;
  path: string;
  labelX: number;
  labelY: number;
  textRotation: number;
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly api = inject(TodoApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('sceneCanvas');

  protected readonly categories: TaskCategory[] = ['Ritual', 'Focus', 'Recharge', 'Admin'];
  protected readonly palette = ['#7c6cff', '#3ba7ff', '#38d39f', '#f4c15d', '#ff6b8a'];

  protected readonly selectedDate = signal(this.today());
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly dashboard = signal<DashboardResponse | null>(null);
  protected readonly selectedTaskId = signal<number | null>(null);
  protected readonly form = signal<TaskFormValue>(this.createDefaultForm(this.today()));

  protected readonly tasks = computed(() => this.dashboard()?.tasks ?? []);
  protected readonly metrics = computed(() => this.dashboard()?.metrics);
  protected readonly insights = computed(() => this.dashboard()?.insights ?? []);
  protected readonly selectedTask = computed(
    () => this.tasks().find((task) => task.id === this.selectedTaskId()) ?? this.tasks()[0] ?? null
  );
  protected readonly completionLabel = computed(() => `${this.metrics()?.completionRate ?? 0}%`);
  protected readonly ringSegments = computed(() => this.buildRingSegments(this.tasks()));
  protected readonly hourMarkers = computed(() =>
    Array.from({ length: 24 }, (_, hour) => this.createMarker(hour))
  );

  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private halo?: THREE.Mesh;
  private particles?: THREE.Points;
  private animationFrame?: number;

  constructor() {
    afterNextRender(() => this.initializeScene());
    void this.loadDay();
  }

  protected async loadDay(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const dashboard = await firstValueFrom(this.api.getDashboard(this.selectedDate()));
      this.dashboard.set(dashboard);
      this.selectedTaskId.set(dashboard.tasks[0]?.id ?? null);
      this.form.set(this.createDefaultForm(dashboard.selectedDate));
    } catch {
      this.error.set('The orbit link to the API is offline. Start the .NET server and reload.');
    } finally {
      this.loading.set(false);
    }
  }

  protected shiftDay(offset: number): void {
    const base = new Date(`${this.selectedDate()}T00:00:00`);
    base.setDate(base.getDate() + offset);
    const nextDate = base.toISOString().slice(0, 10);
    this.selectedDate.set(nextDate);
    this.form.update((form) => ({ ...form, scheduledDate: nextDate }));

    void this.loadDay();
  }

  protected jumpToToday(): void {
    const today = this.today();
    this.selectedDate.set(today);
    this.form.update((form) => ({ ...form, scheduledDate: today }));
    void this.loadDay();
  }

  protected editTask(task: TodoTask): void {
    this.selectedTaskId.set(task.id);
    this.form.set({
      id: task.id,
      title: task.title,
      notes: task.notes ?? '',
      category: task.category,
      accentColor: task.accentColor,
      scheduledDate: task.scheduledDate,
      startTime: this.minutesToTime(task.startMinutes),
      durationMinutes: task.durationMinutes,
      energy: task.energy,
      isCompleted: task.isCompleted
    });
  }

  protected newTask(): void {
    this.selectedTaskId.set(null);
    this.form.set(this.createDefaultForm(this.selectedDate()));
  }

  protected async submitTask(): Promise<void> {
    const value = this.form();
    if (!value.title.trim()) {
      this.error.set('A task needs a title before it can enter the ring.');
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    const request: UpsertTaskRequest = {
      title: value.title,
      notes: value.notes.trim() || null,
      category: value.category,
      accentColor: value.accentColor,
      scheduledDate: value.scheduledDate,
      startMinutes: this.timeToMinutes(value.startTime),
      durationMinutes: value.durationMinutes,
      energy: value.energy,
      isCompleted: value.isCompleted
    };

    try {
      if (value.id) {
        await firstValueFrom(this.api.updateTask(value.id, request));
      } else {
        await firstValueFrom(this.api.createTask(request));
      }

      this.selectedDate.set(value.scheduledDate);
      await this.loadDay();
    } catch {
      this.error.set('Save failed. Check that the API is running and the database file is writable.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async toggleCompletion(task: TodoTask): Promise<void> {
    const request: UpsertTaskRequest = {
      title: task.title,
      notes: task.notes,
      category: task.category,
      accentColor: task.accentColor,
      scheduledDate: task.scheduledDate,
      startMinutes: task.startMinutes,
      durationMinutes: task.durationMinutes,
      energy: task.energy,
      isCompleted: !task.isCompleted
    };

    await firstValueFrom(this.api.updateTask(task.id, request));
    await this.loadDay();
  }

  protected async deleteSelectedTask(): Promise<void> {
    const id = this.form().id;
    if (!id) {
      this.newTask();
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    try {
      await firstValueFrom(this.api.deleteTask(id));
      await this.loadDay();
    } catch {
      this.error.set('Delete failed. The current task could not be removed.');
    } finally {
      this.saving.set(false);
    }
  }

  protected patchForm<K extends keyof TaskFormValue>(key: K, value: TaskFormValue[K]): void {
    this.form.update((form) => ({ ...form, [key]: value }));
  }

  protected formatTimeRange(task: TodoTask): string {
    const start = this.minutesToTime(task.startMinutes);
    const end = this.minutesToTime(task.startMinutes + task.durationMinutes);
    return `${start} - ${end}`;
  }

  protected trackByTaskId(_: number, task: TodoTask): number {
    return task.id;
  }

  private createDefaultForm(date: string): TaskFormValue {
    return {
      id: null,
      title: '',
      notes: '',
      category: 'Focus',
      accentColor: '#3ba7ff',
      scheduledDate: date,
      startTime: '09:00',
      durationMinutes: 60,
      energy: 3,
      isCompleted: false
    };
  }

  private buildRingSegments(tasks: TodoTask[]): RingSegment[] {
    return tasks.map((task) => {
      const startAngle = this.minutesToAngle(task.startMinutes);
      const endAngle = this.minutesToAngle(task.startMinutes + task.durationMinutes);
      const midAngle = (startAngle + endAngle) / 2;
      const radius = 128;
      const labelRadius = 152;
      const radians = (midAngle - 90) * (Math.PI / 180);

      return {
        task,
        path: this.describeArc(180, 180, radius, startAngle, endAngle),
        labelX: 180 + labelRadius * Math.cos(radians),
        labelY: 180 + labelRadius * Math.sin(radians),
        textRotation: midAngle > 180 ? midAngle + 180 : midAngle
      };
    });
  }

  private createMarker(hour: number) {
    const angle = this.minutesToAngle(hour * 60);
    const radians = (angle - 90) * (Math.PI / 180);
    const outer = 170;
    const inner = hour % 6 === 0 ? 150 : 158;
    const labelRadius = 188;

    return {
      hour,
      x1: 180 + outer * Math.cos(radians),
      y1: 180 + outer * Math.sin(radians),
      x2: 180 + inner * Math.cos(radians),
      y2: 180 + inner * Math.sin(radians),
      labelX: 180 + labelRadius * Math.cos(radians),
      labelY: 180 + labelRadius * Math.sin(radians),
      label: `${hour.toString().padStart(2, '0')}:00`
    };
  }

  private minutesToAngle(minutes: number): number {
    return (minutes / 1440) * 360;
  }

  private describeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
    const start = this.polarToCartesian(cx, cy, radius, endAngle);
    const end = this.polarToCartesian(cx, cy, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return ['M', start.x, start.y, 'A', radius, radius, 0, largeArcFlag, 0, end.x, end.y].join(' ');
  }

  private polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
    const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(angleInRadians),
      y: cy + radius * Math.sin(angleInRadians)
    };
  }

  private timeToMinutes(time: string): number {
    const [hour, minute] = time.split(':').map(Number);
    return hour * 60 + minute;
  }

  private minutesToTime(totalMinutes: number): string {
    const normalized = ((totalMinutes % 1440) + 1440) % 1440;
    const hour = Math.floor(normalized / 60);
    const minute = normalized % 60;
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private initializeScene(): void {
    const canvas = this.canvasRef().nativeElement;
    const host = canvas.parentElement;
    if (!host) {
      return;
    }

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 0.1, 100);
    this.camera.position.z = 5;

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(host.clientWidth, host.clientHeight);

    const haloGeometry = new THREE.TorusGeometry(1.55, 0.18, 32, 180);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: '#6c78ff',
      transparent: true,
      opacity: 0.24
    });
    this.halo = new THREE.Mesh(haloGeometry, haloMaterial);
    this.halo.rotation.x = 1.08;
    this.halo.rotation.y = 0.38;
    this.scene.add(this.halo);

    const points = new Float32Array(900);
    for (let index = 0; index < points.length; index += 3) {
      points[index] = (Math.random() - 0.5) * 7;
      points[index + 1] = (Math.random() - 0.5) * 4.5;
      points[index + 2] = (Math.random() - 0.5) * 4;
    }

    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));

    const particleMaterial = new THREE.PointsMaterial({
      color: '#d9f2ff',
      size: 0.02,
      transparent: true,
      opacity: 0.8
    });

    this.particles = new THREE.Points(particleGeometry, particleMaterial);
    this.scene.add(this.particles);

    const onResize = () => {
      if (!this.renderer || !this.camera) {
        return;
      }

      this.camera.aspect = host.clientWidth / host.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(host.clientWidth, host.clientHeight);
    };

    window.addEventListener('resize', onResize);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('resize', onResize);
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
      }
      this.renderer?.dispose();
    });

    const render = () => {
      this.animationFrame = requestAnimationFrame(render);
      if (this.halo) {
        this.halo.rotation.z += 0.0015;
      }
      if (this.particles) {
        this.particles.rotation.y += 0.0008;
      }
      this.renderer?.render(this.scene!, this.camera!);
    };

    render();
  }
}
