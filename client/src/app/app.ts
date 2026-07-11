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
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
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

interface ClockTick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  major: boolean;
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
  protected readonly currentTime = signal(new Date());

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
  protected readonly clockTicks = Array.from({ length: 96 }, (_, index) => this.createClockTick(index));
  protected readonly isToday = computed(() => this.selectedDate() === this.today());
  protected readonly liveClockRotation = computed(() => {
    const time = this.currentTime();
    const minutes = time.getHours() * 60 + time.getMinutes() + time.getSeconds() / 60;
    return (minutes / 1440) * 360;
  });
  protected readonly liveTimeLabel = computed(() =>
    this.currentTime().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );

  private renderer?: THREE.WebGLRenderer;
  private composer?: EffectComposer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private orbitalSystem?: THREE.Group;
  private starLayers: THREE.Points[] = [];
  private energyRibbons: THREE.Line[] = [];
  private clock = new THREE.Clock();
  private pointer = new THREE.Vector2();
  private animationFrame?: number;

  constructor() {
    afterNextRender(() => this.initializeScene());
    const clockTimer = window.setInterval(() => this.currentTime.set(new Date()), 1000);
    this.destroyRef.onDestroy(() => window.clearInterval(clockTimer));
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

  private createClockTick(index: number): ClockTick {
    const angle = (index / 96) * 360;
    const radians = (angle - 90) * (Math.PI / 180);
    const major = index % 4 === 0;
    const outer = 174;
    const inner = major ? 163 : index % 2 === 0 ? 167 : 170;

    return {
      x1: 180 + outer * Math.cos(radians),
      y1: 180 + outer * Math.sin(radians),
      x2: 180 + inner * Math.cos(radians),
      y2: 180 + inner * Math.sin(radians),
      major
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
    this.scene.fog = new THREE.FogExp2(0x040711, 0.085);
    this.camera = new THREE.PerspectiveCamera(42, host.clientWidth / host.clientHeight, 0.1, 100);
    this.camera.position.set(0, 0, 8);

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(host.clientWidth, host.clientHeight),
        window.matchMedia('(max-width: 720px)').matches ? 0.65 : 1.05,
        0.7,
        0.12
      )
    );

    this.orbitalSystem = this.createOrbitalSystem();
    this.orbitalSystem.position.set(2.8, 0.1, -0.8);
    this.scene.add(this.orbitalSystem);
    this.createStarField();

    const onPointerMove = (event: PointerEvent) => {
      this.pointer.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
    };

    const onResize = () => {
      if (!this.renderer || !this.camera) {
        return;
      }

      this.camera.aspect = host.clientWidth / host.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(host.clientWidth, host.clientHeight);
      this.composer?.setSize(host.clientWidth, host.clientHeight);
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
      }
      this.scene?.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      this.composer?.dispose();
      this.renderer?.dispose();
    });

    const render = () => {
      this.animationFrame = requestAnimationFrame(render);
      const elapsed = this.clock.getElapsedTime();

      if (this.orbitalSystem) {
        this.orbitalSystem.rotation.y = elapsed * 0.08 + this.pointer.x * 0.12;
        this.orbitalSystem.rotation.x = Math.sin(elapsed * 0.22) * 0.08 - this.pointer.y * 0.08;
        this.orbitalSystem.position.y = Math.sin(elapsed * 0.45) * 0.12;
      }

      this.energyRibbons.forEach((ribbon, index) => {
        ribbon.rotation.z = elapsed * (index % 2 ? -0.09 : 0.07);
        ribbon.rotation.y = elapsed * 0.035 + index;
      });
      this.starLayers.forEach((stars, index) => {
        stars.rotation.y = elapsed * (0.006 + index * 0.003);
        stars.position.x += (this.pointer.x * (index + 1) * 0.06 - stars.position.x) * 0.015;
      });

      this.camera!.position.x += (this.pointer.x * 0.28 - this.camera!.position.x) * 0.018;
      this.camera!.position.y += (this.pointer.y * 0.18 - this.camera!.position.y) * 0.018;
      this.camera!.lookAt(0, 0, 0);
      this.composer?.render();
    };

    render();
  }

  private createOrbitalSystem(): THREE.Group {
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.82, 5),
      new THREE.MeshBasicMaterial({ color: 0x07121d, wireframe: true, transparent: true, opacity: 0.7 })
    );
    group.add(core);

    const glowCore = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.48, 2),
      new THREE.MeshBasicMaterial({ color: 0x7df9ff, transparent: true, opacity: 0.24 })
    );
    group.add(glowCore);

    const colors = [0x5af2ff, 0xff4fd8, 0xffc857];
    [1.35, 1.82, 2.28].forEach((radius, index) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, index === 1 ? 0.025 : 0.012, 12, 220),
        new THREE.MeshBasicMaterial({ color: colors[index], transparent: true, opacity: 0.62 })
      );
      ring.rotation.set(0.72 + index * 0.42, index * 0.55, index * 0.8);
      group.add(ring);
    });

    for (let index = 0; index < 18; index++) {
      const angle = (index / 18) * Math.PI * 2;
      const radius = 1.38 + (index % 3) * 0.44;
      const satellite = new THREE.Mesh(
        new THREE.SphereGeometry(index % 5 === 0 ? 0.075 : 0.032, 10, 10),
        new THREE.MeshBasicMaterial({ color: colors[index % colors.length] })
      );
      satellite.position.set(Math.cos(angle) * radius, Math.sin(angle * 1.7) * 0.5, Math.sin(angle) * radius);
      group.add(satellite);
    }

    for (let ribbonIndex = 0; ribbonIndex < 3; ribbonIndex++) {
      const points = Array.from({ length: 180 }, (_, index) => {
        const angle = (index / 179) * Math.PI * 2;
        const radius = 2.65 + Math.sin(angle * (3 + ribbonIndex)) * 0.1;
        return new THREE.Vector3(
          Math.cos(angle) * radius,
          Math.sin(angle * 2 + ribbonIndex) * 0.38,
          Math.sin(angle) * radius
        );
      });
      const ribbon = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: colors[ribbonIndex], transparent: true, opacity: 0.28 })
      );
      ribbon.rotation.x = ribbonIndex * 0.75;
      this.energyRibbons.push(ribbon);
      group.add(ribbon);
    }

    return group;
  }

  private createStarField(): void {
    const colors = [0xc7f8ff, 0x6edcff, 0xff8de1];
    [900, 550, 220].forEach((count, layer) => {
      const positions = new Float32Array(count * 3);
      for (let index = 0; index < positions.length; index += 3) {
        const radius = 5 + Math.random() * 15;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[index] = radius * Math.sin(phi) * Math.cos(theta);
        positions[index + 1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[index + 2] = radius * Math.cos(phi) - 4;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const stars = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: colors[layer],
          size: 0.018 + layer * 0.016,
          transparent: true,
          opacity: 0.42 + layer * 0.18,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      );
      this.starLayers.push(stars);
      this.scene?.add(stars);
    });
  }
}
