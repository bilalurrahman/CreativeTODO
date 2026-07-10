using Microsoft.EntityFrameworkCore;
using server.Models;

namespace server.Data;

public class TodoDbContext(DbContextOptions<TodoDbContext> options) : DbContext(options)
{
    public DbSet<TodoTask> Tasks => Set<TodoTask>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<TodoTask>(entity =>
        {
            entity.Property(task => task.Title).HasMaxLength(120);
            entity.Property(task => task.Notes).HasMaxLength(480);
            entity.Property(task => task.AccentColor).HasMaxLength(24);
        });
    }
}
