using server.Models;

namespace server.Data;

public static class SeedData
{
    public static async Task InitializeAsync(TodoDbContext db)
    {
        if (db.Tasks.Any())
        {
            return;
        }

        var today = DateOnly.FromDateTime(DateTime.Today);

        db.Tasks.AddRange(
            new TodoTask
            {
                Title = "Solar warm-up",
                Notes = "Journal, stretch, and define the one thing that matters.",
                Category = TaskCategory.Ritual,
                AccentColor = "#7c6cff",
                ScheduledDate = today,
                StartMinutes = 7 * 60,
                DurationMinutes = 45,
                Energy = 3,
                IsCompleted = true
            },
            new TodoTask
            {
                Title = "Deep build sprint",
                Notes = "Push the primary feature without interruptions.",
                Category = TaskCategory.Focus,
                AccentColor = "#3ba7ff",
                ScheduledDate = today,
                StartMinutes = 9 * 60,
                DurationMinutes = 180,
                Energy = 5,
                IsCompleted = false
            },
            new TodoTask
            {
                Title = "Drift walk",
                Notes = "Take a short walk and capture stray ideas.",
                Category = TaskCategory.Recharge,
                AccentColor = "#3ddc97",
                ScheduledDate = today,
                StartMinutes = 13 * 60 + 15,
                DurationMinutes = 30,
                Energy = 2,
                IsCompleted = false
            },
            new TodoTask
            {
                Title = "Signal review",
                Notes = "Inbox triage, messages, and quick decisions.",
                Category = TaskCategory.Admin,
                AccentColor = "#f4c15d",
                ScheduledDate = today,
                StartMinutes = 17 * 60,
                DurationMinutes = 60,
                Energy = 2,
                IsCompleted = false
            }
        );

        await db.SaveChangesAsync();
    }
}
