using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
namespace Dispatch;
public class DesignTimeFactory : IDesignTimeDbContextFactory<DispatchDb>
{
    public DispatchDb CreateDbContext(string[] args)=>new(new DbContextOptionsBuilder<DispatchDb>().UseNpgsql("Host=127.0.0.1;Database=dispatch;Username=dispatch;Password=design-time-not-used").Options);
}
