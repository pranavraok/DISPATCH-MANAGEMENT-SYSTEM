using Microsoft.EntityFrameworkCore;
namespace Dispatch;
// Local/container worker is optional. The same bounded drain also runs via an authenticated request,
// so serverless scale-to-zero never becomes a durability assumption.
public sealed class OutboxWorker(IServiceScopeFactory scopes,ILogger<OutboxWorker> logger):BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer=new PeriodicTimer(TimeSpan.FromSeconds(10));
        while(await timer.WaitForNextTickAsync(stoppingToken))try{await using var scope=scopes.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<DispatchDb>();await Drain(db,stoppingToken);}catch(Exception e)when(e is not OperationCanceledException){logger.LogWarning(e,"Outbox drain failed; durable events retained");}
    }
    public static Task<int> Drain(DispatchDb db,CancellationToken token=default)=>db.Database.ExecuteSqlRawAsync("""
        WITH pending AS (SELECT "Id" FROM "Outbox" WHERE "DeliveredAt" IS NULL ORDER BY "CreatedAt" LIMIT 100 FOR UPDATE SKIP LOCKED)
        UPDATE "Outbox" SET "DeliveredAt" = now() WHERE "Id" IN (SELECT "Id" FROM pending)
        """,token);
}
