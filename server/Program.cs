using Microsoft.EntityFrameworkCore;
using System.Text.Json.Serialization;
using server.Data;
using server.Models;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<TodoDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("TodoDb") ?? "Data Source=creative-todo.db"));

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

builder.Services.AddCors(options =>
{
    options.AddPolicy("client", policy =>
    {
        policy
            .WithOrigins(
                "http://localhost:4200",
                "http://127.0.0.1:4200",
                "https://localhost:4200",
                "https://127.0.0.1:4200"
            )
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseCors("client");

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
    await db.Database.EnsureCreatedAsync();
    await SeedData.InitializeAsync(db);
}

app.MapGet("/api/dashboard", async (DateOnly? date, TodoDbContext db) =>
{
    var selectedDate = date ?? DateOnly.FromDateTime(DateTime.Today);
    var tasks = await db.Tasks
        .Where(task => task.ScheduledDate == selectedDate)
        .OrderBy(task => task.StartMinutes)
        .ToListAsync();

    var focusMinutes = tasks.Where(task => task.Category == TaskCategory.Focus).Sum(task => task.DurationMinutes);
    var ritualMinutes = tasks.Where(task => task.Category == TaskCategory.Ritual).Sum(task => task.DurationMinutes);
    var rechargeMinutes = tasks.Where(task => task.Category == TaskCategory.Recharge).Sum(task => task.DurationMinutes);
    var completionRate = tasks.Count == 0 ? 0 : Math.Round(tasks.Count(task => task.IsCompleted) / (double)tasks.Count * 100);

    var response = new DashboardResponse(
        selectedDate,
        tasks.Select(TaskDto.FromEntity).ToArray(),
        new DayMetrics(
            focusMinutes,
            ritualMinutes,
            rechargeMinutes,
            completionRate
        ),
        BuildInsights(tasks)
    );

    return Results.Ok(response);
});

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapPost("/api/tasks", async (UpsertTaskRequest request, TodoDbContext db) =>
{
    var task = new TodoTask();
    ApplyRequest(task, request);

    db.Tasks.Add(task);
    await db.SaveChangesAsync();

    return Results.Created($"/api/tasks/{task.Id}", TaskDto.FromEntity(task));
});

app.MapPut("/api/tasks/{id:int}", async (int id, UpsertTaskRequest request, TodoDbContext db) =>
{
    var task = await db.Tasks.FindAsync(id);
    if (task is null)
    {
        return Results.NotFound();
    }

    ApplyRequest(task, request);
    await db.SaveChangesAsync();

    return Results.Ok(TaskDto.FromEntity(task));
});

app.MapDelete("/api/tasks/{id:int}", async (int id, TodoDbContext db) =>
{
    var task = await db.Tasks.FindAsync(id);
    if (task is null)
    {
        return Results.NotFound();
    }

    db.Tasks.Remove(task);
    await db.SaveChangesAsync();

    return Results.NoContent();
});

app.Run();

static string[] BuildInsights(IEnumerable<TodoTask> tasks)
{
    var materialized = tasks.ToList();
    if (materialized.Count == 0)
    {
        return ["Open space detected. Sketch the day by dropping a first ritual or focus block."];
    }

    var longest = materialized.MaxBy(task => task.DurationMinutes);
    var nextOpenSlot = FindOpenSlot(materialized);
    var completed = materialized.Count(task => task.IsCompleted);

    return
    [
        $"{completed}/{materialized.Count} missions complete. Momentum is {(completed >= Math.Ceiling(materialized.Count / 2.0) ? "building" : "warming up")}.",
        longest is null
            ? "No anchor block defined yet."
            : $"Anchor block: {longest.Title} for {longest.DurationMinutes} minutes.",
        nextOpenSlot is null
            ? "The ring is full. Protect some breathing room."
            : $"Next clear window starts at {FormatMinutes(nextOpenSlot.Value)}."
    ];
}

static int? FindOpenSlot(IEnumerable<TodoTask> tasks)
{
    var current = 0;
    foreach (var task in tasks.OrderBy(task => task.StartMinutes))
    {
        if (task.StartMinutes - current >= 45)
        {
            return current;
        }

        current = Math.Max(current, task.StartMinutes + task.DurationMinutes);
    }

    return current <= 22 * 60 ? current : null;
}

static string FormatMinutes(int minutes)
{
    var hour = minutes / 60;
    var minute = minutes % 60;
    return $"{hour:00}:{minute:00}";
}

static void ApplyRequest(TodoTask task, UpsertTaskRequest request)
{
    task.Title = request.Title.Trim();
    task.Notes = request.Notes?.Trim();
    task.Category = request.Category;
    task.AccentColor = request.AccentColor.Trim();
    task.ScheduledDate = request.ScheduledDate;
    task.StartMinutes = Math.Clamp(request.StartMinutes, 0, 23 * 60 + 59);
    task.DurationMinutes = Math.Clamp(request.DurationMinutes, 15, 12 * 60);
    task.Energy = Math.Clamp(request.Energy, 1, 5);
    task.IsCompleted = request.IsCompleted;
}

public record DashboardResponse(
    DateOnly SelectedDate,
    TaskDto[] Tasks,
    DayMetrics Metrics,
    string[] Insights
);

public record DayMetrics(
    int FocusMinutes,
    int RitualMinutes,
    int RechargeMinutes,
    double CompletionRate
);

public record UpsertTaskRequest(
    string Title,
    string? Notes,
    TaskCategory Category,
    string AccentColor,
    DateOnly ScheduledDate,
    int StartMinutes,
    int DurationMinutes,
    int Energy,
    bool IsCompleted
);

public record TaskDto(
    int Id,
    string Title,
    string? Notes,
    TaskCategory Category,
    string AccentColor,
    DateOnly ScheduledDate,
    int StartMinutes,
    int DurationMinutes,
    int Energy,
    bool IsCompleted
)
{
    public static TaskDto FromEntity(TodoTask task) =>
        new(
            task.Id,
            task.Title,
            task.Notes,
            task.Category,
            task.AccentColor,
            task.ScheduledDate,
            task.StartMinutes,
            task.DurationMinutes,
            task.Energy,
            task.IsCompleted
        );
}
