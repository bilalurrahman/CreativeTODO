import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { TodoApiService } from './todo-api.service';

describe('App', () => {
  beforeEach(async () => {
    spyOn(App.prototype as never, 'loadDay').and.resolveTo();
    spyOn(App.prototype as never, 'initializeScene').and.stub();

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: TodoApiService,
          useValue: {
            getDashboard: () =>
              of({
                selectedDate: '2026-07-10',
                tasks: [],
                metrics: {
                  focusMinutes: 0,
                  ritualMinutes: 0,
                  rechargeMinutes: 0,
                  completionRate: 0
                },
                insights: []
              })
          }
        }
      ]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
