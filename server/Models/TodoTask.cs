namespace server.Models;

public class TodoTask
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Notes { get; set; }
    public TaskCategory Category { get; set; }
    public string AccentColor { get; set; } = "#7c6cff";
    public DateOnly ScheduledDate { get; set; }
    public int StartMinutes { get; set; }
    public int DurationMinutes { get; set; }
    public int Energy { get; set; }
    public bool IsCompleted { get; set; }
}

public enum TaskCategory
{
    Ritual,
    Focus,
    Recharge,
    Admin
}
