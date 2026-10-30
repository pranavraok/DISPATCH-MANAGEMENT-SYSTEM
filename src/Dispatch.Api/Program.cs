using System.Security.Cryptography;
using System.Threading.RateLimiting;
using Dispatch;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.AddJsonConsole();
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString);
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 2 * 1024 * 1024);
var connection = builder.Configuration["ConnectionStrings:Dispatch"] ?? builder.Configuration["DATABASE_URL"];
if (connection?.StartsWith("postgres") == true) { var u = new Uri(connection); var credentials = u.UserInfo.Split(':', 2); connection = new Npgsql.NpgsqlConnectionStringBuilder { Host = u.Host, Port = u.IsDefaultPort ? 5432 : u.Port, Database = u.AbsolutePath.Trim('/'), Username = Uri.UnescapeDataString(credentials[0]), Password = Uri.UnescapeDataString(credentials[1]), SslMode = Npgsql.SslMode.Require, MaxPoolSize = 20 }.ConnectionString; }
builder.Services.AddDbContext<DispatchDb>(o => o.UseNpgsql(connection ?? "Host=127.0.0.1;Database=dispatch;Username=dispatch;Password=not-configured"));
builder.Services.AddScoped<Operations>();
if (builder.Configuration["EnableOutboxWorker"] == "true") builder.Services.AddHostedService<OutboxWorker>();
var origins = (builder.Configuration["AllowedOrigins"] ?? "http://127.0.0.1:5173,http://localhost:5173").Split(',', StringSplitOptions.RemoveEmptyEntries);
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
builder.Services.AddRateLimiter(o => { o.RejectionStatusCode = 429; o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })); o.AddPolicy("api", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Request.Cookies["dispatch_session"] ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 600, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })); });
var app = builder.Build();
if (args.Contains("--migrate-only"))
{
    if (connection == null) throw new InvalidOperationException("Configure the database before running migrations.");
    await using var scope = app.Services.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<DispatchDb>();
    await db.Database.MigrateAsync();
    await Seed.Run(db, builder.Configuration);
    Console.WriteLine("Database migrations completed. No web server started.");
    return;
}
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers["X-Content-Type-Options"] = "nosniff"; ctx.Response.Headers["Referrer-Policy"] = "same-origin"; ctx.Response.Headers["X-Frame-Options"] = "DENY";
    if (ctx.Request.Path.StartsWithSegments("/api")) ctx.Response.Headers.CacheControl = "no-store";
    try { await next(); }
    catch (RuleException e) { ctx.Response.StatusCode = e.Status; await ctx.Response.WriteAsJsonAsync(new { error = e.Message, correlationId = ctx.TraceIdentifier }); }
    catch (DbUpdateConcurrencyException) { ctx.Response.StatusCode = 409; await ctx.Response.WriteAsJsonAsync(new { error = "This record changed. Refresh the page and try again." }); }
    catch (Exception e) { app.Logger.LogError(e, "Request {CorrelationId} failed", ctx.TraceIdentifier); ctx.Response.StatusCode = 500; await ctx.Response.WriteAsJsonAsync(new { error = "The result could not be confirmed. Check the saved result before trying again.", correlationId = ctx.TraceIdentifier }); }
});
app.UseCors(); app.UseRateLimiter(); app.UseDefaultFiles(); app.UseStaticFiles();
if (connection != null && builder.Configuration["MigrateOnStart"] == "true") { await using var scope = app.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<DispatchDb>(); await db.Database.MigrateAsync(); await Seed.Run(db, builder.Configuration); }
app.MapGet("/api/health", async (DispatchDb db) => { var connected = connection != null && await db.Database.CanConnectAsync(); return Results.Json(new { service = "Electro Group Dispatch API", database = connected ? "Connected" : "Not configured / unavailable", postingEnabled = false, environment = app.Environment.EnvironmentName, version = "0.1.0" }, statusCode: connected ? 200 : 503); });
app.MapPost("/api/auth/login", async (Login input, HttpContext ctx, DispatchDb db) =>
{
    var email = input.Email.Trim().ToLowerInvariant(); var user = await db.Users.SingleOrDefaultAsync(x => x.Email == email && x.Active); var hasher = new PasswordHasher<User>();
    if (user == null || hasher.VerifyHashedPassword(user, user.PasswordHash, input.Password) == PasswordVerificationResult.Failed) throw new RuleException("Email or password is incorrect.", 401);
    var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)); var csrf = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)); db.Sessions.Add(new Session { CompanyId = user.CompanyId, UserId = user.Id, TokenHash = Operations.Hash(token), Csrf = csrf, Expires = DateTimeOffset.UtcNow.AddHours(8) }); await db.SaveChangesAsync();
    ctx.Response.Cookies.Append("dispatch_session", token, new CookieOptions { HttpOnly = true, Secure = !app.Environment.IsDevelopment(), SameSite = SameSiteMode.Lax, Path = "/", MaxAge = TimeSpan.FromHours(8), IsEssential = true }); return Results.Ok(new { user = new { user.Id, user.Name, user.Email, user.Roles, user.CompanyId }, csrf });
}).RequireRateLimiting("login");
app.MapGet("/api/auth/me", async (HttpContext ctx, DispatchDb db) => { var (u, s) = await Auth.User(ctx, db); return Results.Ok(new { user = new { u.Id, u.Name, u.Email, u.Roles, u.CompanyId }, csrf = s.Csrf }); });
app.MapPost("/api/auth/logout", async (HttpContext ctx, DispatchDb db) => { var (_, s) = await Auth.User(ctx, db, true); db.Sessions.Remove(s); await db.SaveChangesAsync(); ctx.Response.Cookies.Delete("dispatch_session"); return Results.Ok(); });
app.MapGet("/api/state", async (HttpContext ctx, DispatchDb db, int? page, int? pageSize, string? search) =>
{
    var (u, _) = await Auth.User(ctx, db); var c = u.CompanyId; var take = Math.Clamp(pageSize ?? 200, 1, 500); var skip = Math.Max(0, page ?? 0) * take; var cartonQuery = db.Cartons.Where(x => x.CompanyId == c); if (!string.IsNullOrWhiteSpace(search)) cartonQuery = cartonQuery.Where(x => x.Id.Contains(search) || x.Marking.Contains(search));
    var counts = await db.Cartons.Where(x => x.CompanyId == c).GroupBy(x => x.State).Select(g => new { state = g.Key, count = g.Count() }).ToListAsync();
    return Results.Ok(new
    {
        company = await db.Companies.SingleAsync(x => x.Id == c),
        warehouses = await db.Warehouses.Where(x => x.CompanyId == c).ToListAsync(),
        products = await db.Products.Where(x => x.CompanyId == c).OrderBy(x => x.Sku).Take(500).ToListAsync(),
        customers = await db.Customers.Where(x => x.CompanyId == c).Take(500).ToListAsync(),
        manifests = await db.Manifests.Where(x => x.CompanyId == c).OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync(),
        cartons = await cartonQuery.OrderBy(x => x.Id).Skip(skip).Take(take).ToListAsync(),
        cartonTotal = await cartonQuery.CountAsync(),
        counts,
        trips = await db.Trips.Where(x => x.CompanyId == c).OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync(),
        shipments = await db.Shipments.Where(x => x.CompanyId == c).OrderByDescending(x => x.Id).Take(200).ToListAsync(),
        allocations = await db.Allocations.Where(x => x.CompanyId == c && x.Active).Take(10000).ToListAsync(),
        loadingSessions = await db.LoadingSessions.Where(x => x.CompanyId == c && x.UserId == u.Id && x.Active).ToListAsync(),
        billings = await db.Billings.Where(x => x.CompanyId == c).OrderByDescending(x => x.Revision).Take(200).ToListAsync(),
        jobs = await db.Jobs.Where(x => x.CompanyId == c).OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync(),
        labels = await db.Labels.Where(x => x.CompanyId == c).OrderByDescending(x => x.CreatedAt).Take(30).ToListAsync(),
        returns = await db.Returns.Where(x => x.CompanyId == c).Take(100).ToListAsync(),
        mapping = await db.Mappings.SingleAsync(x => x.CompanyId == c),
        connectors = await db.Connectors.Where(x => x.CompanyId == c).Select(x => new { x.Id, x.Name, x.ExpectedCompany, x.Environment, x.Revoked, x.LastSeen, x.Diagnostics }).ToListAsync(),
        audit = await db.Audit.Where(x => x.CompanyId == c).OrderByDescending(x => x.At).Take(80).ToListAsync(),
        users = u.Roles.Contains("Admin") ? await db.Users.Where(x => x.CompanyId == c).Select(x => new { x.Id, x.Name, x.Email, x.Roles, x.Active }).ToListAsync() : null,
        serverTime = DateTimeOffset.UtcNow,
        postingEnabled = false
    });
}).RequireRateLimiting("api");
app.MapPost("/api/commands", async (Command command, HttpContext ctx, DispatchDb db, Operations ops) => { var (u, _) = await Auth.User(ctx, db, true); return Results.Ok(await ops.Execute(u, command)); }).RequireRateLimiting("api");
app.MapGet("/api/work/{kind}/{id}", WorkQueries.Read).RequireRateLimiting("api");
app.MapGet("/api/requests/{id}", async (string id, HttpContext ctx, DispatchDb db) => { var (u, _) = await Auth.User(ctx, db); var r = await db.Requests.SingleOrDefaultAsync(x => x.Id == id && x.CompanyId == u.CompanyId && x.ActorId == u.Id); return r == null ? Results.NotFound(new { state = "Unknown", message = "Original request may still be in flight. Retry only the same envelope and request ID." }) : Results.Content(r.Response, "application/json"); });
app.MapPost("/api/maintenance/outbox", async (HttpContext ctx, DispatchDb db) => { var (u, _) = await Auth.User(ctx, db, true); Permissions.Require(u); return Results.Ok(new { events = await OutboxWorker.Drain(db), delivery = "Audit-feed polling. This does not claim delivery to email, Tally or printers." }); });
app.MapGet("/api/cartons/{id}/history", async (string id, HttpContext ctx, DispatchDb db) => { var (u, _) = await Auth.User(ctx, db); var carton = await db.Cartons.SingleOrDefaultAsync(x => x.CompanyId == u.CompanyId && x.Id == id) ?? throw new RuleException("Carton unavailable.", 404); return Results.Ok(new { carton, events = await db.Audit.Where(x => x.CompanyId == u.CompanyId && (x.EntityId == id || x.Data.Contains(id))).OrderBy(x => x.At).Take(500).ToListAsync() }); });
app.MapGet("/api/documents/shipment/{id}", async (string id, HttpContext ctx, DispatchDb db) => { var (u, _) = await Auth.User(ctx, db); var s = await db.Shipments.SingleOrDefaultAsync(x => x.Id == id && x.CompanyId == u.CompanyId) ?? throw new RuleException("Shipment unavailable.", 404); var cartonIds = await db.Allocations.Where(x => x.CompanyId == u.CompanyId && x.ShipmentId == id && x.Active).Select(x => x.CartonId).ToArrayAsync(); return Results.Ok(new { documentType = "Packing list - not a tax invoice", shipment = s, customer = await db.Customers.SingleAsync(x => x.Id == s.CustomerId && x.CompanyId == u.CompanyId), cartons = await db.Cartons.Where(x => x.CompanyId == u.CompanyId && cartonIds.Contains(x.Id)).ToListAsync() }); });
app.MapPost("/api/connector/heartbeat", async (Heartbeat input, HttpContext ctx, DispatchDb db) =>
{
    var c = await Auth.Connector(ctx, db); if (input.Company != c.ExpectedCompany || input.Environment != c.Environment) throw new RuleException("Wrong company or environment. Integration stopped.", 409); c.LastSeen = DateTimeOffset.UtcNow; c.Diagnostics = Json.Write(new { input.TallyReachable, input.Version, input.Detail, company = input.Company, postingEnabled = false }); await db.SaveChangesAsync(); return Results.Ok(new { postingEnabled = false, expectedCompany = c.ExpectedCompany, message = "Diagnostics only; posting contract is unvalidated." });
});
app.MapPost("/api/connector/masters", async (MasterSnapshot input, HttpContext ctx, DispatchDb db) =>
{
    var c = await Auth.Connector(ctx, db); if (input.Company != c.ExpectedCompany || input.Environment != c.Environment || input.Items.Length > 500) throw new RuleException("Wrong scope or snapshot exceeds 500 rows."); await using var tx = await db.Database.BeginTransactionAsync(); await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({c.CompanyId},0))");
    foreach (var item in input.Items) { var p = await db.Products.SingleOrDefaultAsync(x => x.CompanyId == c.CompanyId && x.TallyId == item.NativeId); if (p == null) continue; if (p.Unit != item.Unit) throw new RuleException("Mapped product unit changed. Resolve mapping explicitly."); p.TallyName = item.Name; p.BookBalance = item.Balance; p.SyncedAt = DateTimeOffset.UtcNow; }
    var m = await db.Mappings.SingleAsync(x => x.CompanyId == c.CompanyId); m.SyncedAt = DateTimeOffset.UtcNow; var audit = new AuditEvent { CompanyId = c.CompanyId, ActorId = c.Id, Action = "masterSync", Data = Json.Write(new { count = input.Items.Length }) }; db.Audit.Add(audit); db.Outbox.Add(new OutboxEvent { CompanyId = c.CompanyId, AuditId = audit.Id }); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(new { message = "Existing stable-ID mappings refreshed. Unknown masters were not auto-created." });
});
app.MapGet("/api/connector/jobs/next", async (HttpContext ctx, DispatchDb db) => { await Auth.Connector(ctx, db); return Results.Json(new { state = "Blocked", reason = "No validated posting/readback contract. No voucher Create command is issued." }, statusCode: 409); });
app.MapFallbackToFile("index.html");
await app.RunAsync();

record Login(string Email, string Password);
record Heartbeat(string Company, string Environment, bool TallyReachable, string Version, string Detail);
record MasterItem(string NativeId, string Name, string Unit, decimal Balance);
record MasterSnapshot(string Company, string Environment, MasterItem[] Items);
static class Auth
{
    public static async Task<(User, Session)> User(HttpContext ctx, DispatchDb db, bool mutation = false)
    {
        var token = ctx.Request.Cookies["dispatch_session"]; if (token == null || token.Length != 64) throw new RuleException("Sign in to continue.", 401); var hash = Operations.Hash(token); var s = await db.Sessions.SingleOrDefaultAsync(x => x.TokenHash == hash && x.Expires > DateTimeOffset.UtcNow) ?? throw new RuleException("Session expired. Sign in again.", 401); var u = await db.Users.SingleOrDefaultAsync(x => x.Id == s.UserId && x.CompanyId == s.CompanyId && x.Active) ?? throw new RuleException("Account disabled.", 401);
        if (mutation && ctx.Request.Headers["X-CSRF-Token"] != s.Csrf) throw new RuleException("Security token missing. Refresh and sign in again.", 403); return (u, s);
    }
    public static async Task<Connector> Connector(HttpContext ctx, DispatchDb db)
    {
        var id = ctx.Request.Headers["X-Connector-Id"].ToString(); var secret = ctx.Request.Headers["X-Connector-Key"].ToString(); if (secret.Length != 64) throw new RuleException("Invalid connector credential.", 401); var c = await db.Connectors.SingleOrDefaultAsync(x => x.Id == id && !x.Revoked) ?? throw new RuleException("Connector is revoked or unknown.", 401); if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(c.SecretHash), Convert.FromHexString(Operations.Hash(secret)))) throw new RuleException("Invalid connector credential.", 401); return c;
    }
}
public partial class Program;
