using System.Security.Cryptography;
using System.Text.Json;
using System.Threading.RateLimiting;
using Dispatch;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var site = SiteProfile.From(builder.Configuration);
var deployment = new DeploymentScope(site, builder.Configuration["AromazenTallyCompany"]);
builder.Services.AddSingleton(deployment);
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
if (app.Environment.IsProduction() && site == null) throw new InvalidOperationException("Production requires DispatchSite=electro or aromazon.");
if (args.Contains("--migrate-only"))
{
    if (connection == null) throw new InvalidOperationException("Configure the database before running migrations.");
    await using var scope = app.Services.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<DispatchDb>();
    await db.Database.MigrateAsync();
    await Seed.Run(db, builder.Configuration);
    if (site != null) await site.ValidateDatabase(db);
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
if (connection != null && site != null) { await using var scope = app.Services.CreateAsyncScope(); await site.ValidateDatabase(scope.ServiceProvider.GetRequiredService<DispatchDb>()); }
app.MapGet("/api/site", () => Results.Ok(site));
app.MapGet("/api/health", async (DispatchDb db) => { var connected = connection != null && await db.Database.CanConnectAsync(); var ready = false; if (connected && site != null && deployment.PostingSupported) { var mapping = await db.Mappings.SingleOrDefaultAsync(x => x.CompanyId == site.CompanyId); if (mapping?.ContractValidated == true) { var live = await db.Connectors.Where(x => x.CompanyId == site.CompanyId && !x.Revoked && x.Environment == "Production" && x.ExpectedCompany == mapping.ExpectedCompany && x.LastSeen > DateTimeOffset.UtcNow.AddMinutes(-4)).ToListAsync(); ready = live.Any(x => HasProductionInvoiceSetup(x.MastersSnapshot)); } } return Results.Json(new { service = (site?.CompanyName ?? "Dispatch") + " API", site = site?.Slug, workflow = site?.Workflow, database = connected ? "Connected" : "Not configured / unavailable", postingEnabled = ready, environment = app.Environment.EnvironmentName, version = "0.2.0" }, statusCode: connected ? 200 : 503); });
app.MapPost("/api/auth/login", async (Login input, HttpContext ctx, DispatchDb db) =>
{
    var email = input.Email.Trim().ToLowerInvariant(); var user = await db.Users.SingleOrDefaultAsync(x => x.Email == email && x.Active && (site == null || x.CompanyId == site.CompanyId)); var hasher = new PasswordHasher<User>();
    if (user == null || hasher.VerifyHashedPassword(user, user.PasswordHash, input.Password) == PasswordVerificationResult.Failed) throw new RuleException("Email or password is incorrect.", 401);
    var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)); var csrf = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)); db.Sessions.Add(new Session { CompanyId = user.CompanyId, UserId = user.Id, TokenHash = Operations.Hash(token), Csrf = csrf, Expires = DateTimeOffset.UtcNow.AddHours(8) }); await db.SaveChangesAsync();
    ctx.Response.Cookies.Append("dispatch_session", token, new CookieOptions { HttpOnly = true, Secure = !app.Environment.IsDevelopment(), SameSite = SameSiteMode.Lax, Path = "/", MaxAge = TimeSpan.FromHours(8), IsEssential = true }); return Results.Ok(new { user = new { user.Id, user.Name, user.Email, user.Roles, user.CompanyId }, csrf });
}).RequireRateLimiting("login");
app.MapGet("/api/auth/me", async (HttpContext ctx, DispatchDb db) => { var (u, s) = await Auth.User(ctx, db); return Results.Ok(new { user = new { u.Id, u.Name, u.Email, u.Roles, u.CompanyId }, csrf = s.Csrf }); });
app.MapPost("/api/auth/logout", async (HttpContext ctx, DispatchDb db) => { var (_, s) = await Auth.User(ctx, db, true); db.Sessions.Remove(s); await db.SaveChangesAsync(); ctx.Response.Cookies.Delete("dispatch_session"); return Results.Ok(); });
app.MapGet("/api/state", async (HttpContext ctx, DispatchDb db, int? page, int? pageSize, string? search, string? workflow) =>
{
    var (u, _) = await Auth.User(ctx, db); var c = u.CompanyId; var flow = site?.Resolve(workflow) ?? Workflows.Parse(workflow); var take = Math.Clamp(pageSize ?? 200, 1, 500); var skip = Math.Max(0, page ?? 0) * take;
    var manifests = db.Manifests.Where(x => x.CompanyId == c && x.Workflow == flow);
    var shipments = db.Shipments.Where(x => x.CompanyId == c && x.Workflow == flow);
    var flowCartons = db.Cartons.Where(x => x.CompanyId == c && manifests.Any(m => m.Id == x.ManifestId));
    var cartonQuery = flowCartons; if (!string.IsNullOrWhiteSpace(search)) cartonQuery = cartonQuery.Where(x => x.Id.Contains(search) || x.Marking.Contains(search));
    var counts = await flowCartons.GroupBy(x => x.State).Select(g => new { state = g.Key, count = g.Count() }).ToListAsync();
    var mapping = await db.Mappings.SingleAsync(x => x.CompanyId == c);
    var connectorRows = await db.Connectors.Where(x => x.CompanyId == c).ToListAsync();
    var connectors = connectorRows.Select(x => new { x.Id, x.Name, x.ExpectedCompany, x.Environment, x.Revoked, x.LastSeen, x.Diagnostics, x.MastersSyncedAt, ledgerOptions = TallyLedgerOptions.Read(x.MastersSnapshot) }).ToArray();
    var postingEnabled = deployment.PostingSupported && mapping.ContractValidated && connectorRows.Any(x => !x.Revoked && x.Environment == "Production" && x.ExpectedCompany == mapping.ExpectedCompany && x.LastSeen > DateTimeOffset.UtcNow.AddMinutes(-4) && HasProductionInvoiceSetup(x.MastersSnapshot));
    return Results.Ok(new
    {
        company = await db.Companies.SingleAsync(x => x.Id == c),
        workflow = flow,
        orders = await db.Orders.Where(x => x.CompanyId == c && x.Workflow == flow).OrderByDescending(x => x.CreatedAt).Take(500).ToListAsync(),
        orderProgress = await db.Orders.Where(o => o.CompanyId == c && o.Workflow == flow).OrderByDescending(o => o.CreatedAt).Take(500).Select(o => new {
            orderId = o.Id,
            packedCartons = db.Cartons.Count(box => box.CompanyId == c && box.State != "Retired" && manifests.Any(m => m.Id == box.ManifestId && m.OrderId == o.Id)),
            assignedCartons = db.Allocations.Count(a => a.CompanyId == c && a.Active && shipments.Any(s => s.Id == a.ShipmentId && s.OrderId == o.Id && s.State != "Cancelled"))
        }).ToListAsync(),
        warehouses = await db.Warehouses.Where(x => x.CompanyId == c).ToListAsync(),
        products = await db.Products.Where(x => x.CompanyId == c
            && !((x.TallyName ?? x.Name).StartsWith("ARCHIVE - UNUSED -")))
            .OrderBy(x => x.Sku).Take(500).ToListAsync(),
        customers = await db.Customers.Where(x => x.CompanyId == c).Take(500).ToListAsync(),
        manifests = await manifests.OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync(),
        cartons = await cartonQuery.OrderBy(x => x.Id).Skip(skip).Take(take).ToListAsync(),
        cartonTotal = await cartonQuery.CountAsync(),
        counts,
        trips = await db.Trips.Where(x => x.CompanyId == c && x.Workflow == flow).OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync(),
        shipments = await shipments.OrderByDescending(x => x.Id).Take(200).ToListAsync(),
        allocations = await db.Allocations.Where(x => x.CompanyId == c && x.Active && shipments.Any(s => s.Id == x.ShipmentId)).Take(10000).ToListAsync(),
        loadingSessions = await db.LoadingSessions.Where(x => x.CompanyId == c && x.UserId == u.Id && x.Active && shipments.Any(s => s.Id == x.ShipmentId)).ToListAsync(),
        billings = await db.Billings.Where(x => x.CompanyId == c && shipments.Any(s => s.Id == x.ShipmentId)).OrderByDescending(x => x.Revision).Take(200).ToListAsync(),
        jobs = await db.Jobs.Where(x => x.CompanyId == c && shipments.Any(s => s.Id == x.ShipmentId)).OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync(),
        labels = await db.Labels.Where(x => x.CompanyId == c && x.Workflow == flow).OrderByDescending(x => x.CreatedAt).Take(30).ToListAsync(),
        returns = await db.Returns.Where(x => x.CompanyId == c && shipments.Any(s => s.Id == x.ShipmentId)).Take(100).ToListAsync(),
        mapping,
        connectors,
        demoTaxSetup = connectorRows.Any(x => !x.Revoked && x.Environment == "Production" && HasDemoTaxLedgers(x.MastersSnapshot)),
        audit = await db.Audit.Where(x => x.CompanyId == c && (x.Workflow == null || x.Workflow == flow)).OrderByDescending(x => x.At).Take(80).ToListAsync(),
        users = u.Roles.Contains("Admin") ? await db.Users.Where(x => x.CompanyId == c).Select(x => new { x.Id, x.Name, x.Email, x.Roles, x.Active }).ToListAsync() : null,
        serverTime = DateTimeOffset.UtcNow,
        postingEnabled
    });
}).RequireRateLimiting("api");
app.MapPost("/api/commands", async (Command command, HttpContext ctx, DispatchDb db, Operations ops) => { var (u, _) = await Auth.User(ctx, db, true); return Results.Ok(await ops.Execute(u, command)); }).RequireRateLimiting("api");
app.MapGet("/api/work/{kind}/{id}", WorkQueries.Read).RequireRateLimiting("api");
app.MapGet("/api/requests/{id}", async (string id, HttpContext ctx, DispatchDb db) => { var (u, _) = await Auth.User(ctx, db); var r = await db.Requests.SingleOrDefaultAsync(x => x.Id == id && x.CompanyId == u.CompanyId && x.ActorId == u.Id); return r == null ? Results.NotFound(new { state = "Unknown", message = "Original request may still be in flight. Retry only the same envelope and request ID." }) : Results.Content(r.Response, "application/json"); });
app.MapPost("/api/maintenance/outbox", async (HttpContext ctx, DispatchDb db) => { var (u, _) = await Auth.User(ctx, db, true); Permissions.Require(u); return Results.Ok(new { events = await OutboxWorker.Drain(db), delivery = "Audit-feed polling. This does not claim delivery to email, Tally or printers." }); });
app.MapGet("/api/cartons/{id}/history", async (string id, HttpContext ctx, DispatchDb db) => { var (u, _) = await Auth.User(ctx, db); var carton = await db.Cartons.SingleOrDefaultAsync(x => x.CompanyId == u.CompanyId && x.Id == id && (site == null || db.Manifests.Any(m => m.Id == x.ManifestId && m.CompanyId == u.CompanyId && m.Workflow == site.Workflow))) ?? throw new RuleException("Carton unavailable.", 404); return Results.Ok(new { carton, events = await db.Audit.Where(x => x.CompanyId == u.CompanyId && (x.EntityId == id || x.Data.Contains(id))).OrderBy(x => x.At).Take(500).ToListAsync() }); });
app.MapGet("/api/documents/shipment/{id}", async (string id, HttpContext ctx, DispatchDb db) => { var (u, _) = await Auth.User(ctx, db); var s = await db.Shipments.SingleOrDefaultAsync(x => x.Id == id && x.CompanyId == u.CompanyId && (site == null || x.Workflow == site.Workflow)) ?? throw new RuleException("Shipment unavailable.", 404); var cartonIds = await db.Allocations.Where(x => x.CompanyId == u.CompanyId && x.ShipmentId == id && x.Active).Select(x => x.CartonId).ToArrayAsync(); return Results.Ok(new { documentType = "Packing list - not a tax invoice", shipment = s, customer = await db.Customers.SingleAsync(x => x.Id == s.CustomerId && x.CompanyId == u.CompanyId), cartons = await db.Cartons.Where(x => x.CompanyId == u.CompanyId && cartonIds.Contains(x.Id)).ToListAsync() }); });
app.MapPost("/api/connector/production-upgrade", async (ProductionUpgrade input, HttpContext ctx, DispatchDb db) =>
{
    var c = await Auth.Connector(ctx, db);
    if (site?.Slug != "aromazon" || !deployment.PostingSupported || c.CompanyId != site.CompanyId ||
        c.ExpectedCompany != deployment.ExactTallyCompany || input.Company != deployment.ExactTallyCompany || !input.ConfirmProduction)
        throw new RuleException("Production upgrade requires the paired AROMAZEN connector and this deployment's exact configured Tally company.", 403);
    await using var tx = await db.Database.BeginTransactionAsync();
    await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({c.CompanyId},0))");
    await db.Entry(c).ReloadAsync();
    if (c.Environment == "Production") return Results.Ok(new { environment = "Production", expectedCompany = c.ExpectedCompany, message = "Production connection already verified. Accounting mapping is checked separately." });
    if (c.Environment != "Test") throw new RuleException("Unsupported connector environment.", 409);
    if (await db.Jobs.AnyAsync(j => j.CompanyId == c.CompanyId && (j.State == "Queued" || j.State == "Claimed" || j.State == "Sending" || j.State == "ConfirmationUnknown" || j.State == "NeedsReview")))
        throw new RuleException("Resolve outstanding invoice jobs before changing the connector environment.", 409);
    var mapping = await db.Mappings.SingleAsync(m => m.CompanyId == c.CompanyId);
    mapping.ContractValidated = false; mapping.Pattern = "Unvalidated";
    c.Environment = "Production";
    if (c.Name == "Tally test PC") c.Name = "AROMAZEN Tally PC";
    var audit = new AuditEvent { CompanyId = c.CompanyId, ActorId = c.Id, Action = "connectorProductionUpgrade", EntityId = c.Id, Data = Json.Write(new { c.ExpectedCompany, previousEnvironment = "Test", environment = "Production", invoiceMappingReset = true }) };
    db.Audit.Add(audit); db.Outbox.Add(new OutboxEvent { CompanyId = c.CompanyId, AuditId = audit.Id });
    await db.SaveChangesAsync(); await tx.CommitAsync();
    return Results.Ok(new { environment = "Production", expectedCompany = c.ExpectedCompany, message = "AROMAZEN connection upgraded. Validate the accounting mapping separately before invoicing." });
});
app.MapPost("/api/connector/heartbeat", async (Heartbeat input, HttpContext ctx, DispatchDb db) =>
{
    var c = await Auth.Connector(ctx, db); if (input.Company != c.ExpectedCompany || input.Environment != c.Environment) throw new RuleException("Wrong company or environment. Integration stopped.", 409); c.LastSeen = DateTimeOffset.UtcNow; c.Diagnostics = Json.Write(new { input.TallyReachable, input.Version, input.Detail, company = input.Company, postingEnabled = false }); await db.SaveChangesAsync(); return Results.Ok(new { postingEnabled = false, expectedCompany = c.ExpectedCompany, message = "Diagnostics only; posting contract is unvalidated." });
});
app.MapPost("/api/connector/masters", async (MasterSnapshot input, HttpContext ctx, DispatchDb db) =>
{
    var c = await Auth.Connector(ctx, db); if (!deployment.PostingSupported) throw new RuleException("Configure the deployment's exact Tally company before synchronizing masters.", 403);
    if (c.Environment != "Production" || c.ExpectedCompany != deployment.ExactTallyCompany) throw new RuleException("The connector is not scoped to this site's exact production company.", 403);
    if (input.Company != c.ExpectedCompany || input.Environment != "Production" || input.Items.Length > 500 || input.Ledgers.Length > 1000) throw new RuleException("Wrong company scope or master snapshot exceeds the limit.");
    if (input.Items.Length == 0 || input.Ledgers.Length == 0) throw new RuleException("Tally returned an empty master list. The previous synchronized records were kept.", 409);
    await using var tx = await db.Database.BeginTransactionAsync(); await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({c.CompanyId},0))");
    var snapshot = new TallyMasterSnapshot(input.Company, input.Environment, input.Items, input.Ledgers, input.CompanyState);
    var serialized = Json.Write(snapshot); var changed = c.MastersSnapshot != serialized;
    var syncedAt = DateTimeOffset.UtcNow;
    var totals = await TallyMasterSync.Apply(db, c.CompanyId, snapshot);
    c.MastersSnapshot = serialized; c.MastersSyncedAt = syncedAt;
    (await db.Mappings.SingleAsync(x => x.CompanyId == c.CompanyId)).SyncedAt = syncedAt;
    if (changed)
    {
        var audit = new AuditEvent { CompanyId = c.CompanyId, ActorId = c.Id, Action = "tallyMasterSync", EntityId = c.Id, Data = Json.Write(new { company = input.Company, syncedAt, totals }) };
        db.Audit.Add(audit); db.Outbox.Add(new OutboxEvent { CompanyId = c.CompanyId, AuditId = audit.Id });
    }
    await db.SaveChangesAsync(); await tx.CommitAsync();
    return Results.Ok(new { message = "Tally stock items and customer ledgers synchronized automatically.", totals, syncedAt, changed });
});
app.MapGet("/api/connector/jobs/next", async (HttpContext ctx, DispatchDb db) =>
{
    var c = await Auth.Connector(ctx, db);
    if (!deployment.PostingSupported || c.Environment != "Production" || c.ExpectedCompany != deployment.ExactTallyCompany) throw new RuleException("Invoice posting requires this site's exact production company.", 403);
    var mapping = await db.Mappings.SingleAsync(x => x.CompanyId == c.CompanyId);
    if (!mapping.ContractValidated || mapping.Pattern != deployment.InvoicePattern) return Results.NoContent();
    await using var tx = await db.Database.BeginTransactionAsync();
    await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({c.CompanyId},0))");
    var now = DateTimeOffset.UtcNow;
    var job = await db.Jobs.Where(x => x.CompanyId == c.CompanyId && x.ConnectorId == c.Id && (x.State == "Sending" || x.State == "ConfirmationUnknown" || x.State == "NeedsReview"))
        .OrderBy(x => x.CreatedAt).FirstOrDefaultAsync();
    var reconcileOnly = job != null;
    if (job == null)
    {
        job = await db.Jobs.Where(x => x.CompanyId == c.CompanyId && (x.State == "Queued" || (x.State == "Claimed" && x.LeaseExpires < now)))
            .OrderBy(x => x.CreatedAt).FirstOrDefaultAsync();
        if (job == null) return Results.NoContent();
        job.State = "Claimed"; job.ConnectorId = c.Id; job.LeaseExpires = now.AddMinutes(2);
    }
    else job.LeaseExpires = now.AddMinutes(2);
    var detail = TallyJobDetails.Read(job.Detail);
    if (job.State == "ConfirmationUnknown" && detail.RetryAuthorized) reconcileOnly = false;
    if (detail.Payload == null || job.PayloadHash != Operations.Hash(Json.Write(detail.Payload))) throw new RuleException("Invoice payload is missing or changed. Reconciliation is required.", 409);
    if (detail.Payload.Lines.Any(x => x.DiscountPercent > 0) || detail.Payload.Freight > 0 || detail.Payload.OtherCharges > 0)
    {
        var diagnostics = Json.Read<ConnectorDiagnostics>(c.Diagnostics);
        if (diagnostics.Version != "1.7.0-electro-charges" && diagnostics.Version != "1.8.0-company-dispatch")
            throw new RuleException("Invoice discounts and additional charges are mapped, but the Tally PC connector must be updated before this invoice can be sent. Keep this bill saved; no voucher was sent.", 409);
    }
    await db.SaveChangesAsync(); await tx.CommitAsync();
    return Results.Ok(new { jobId = job.Id, payloadHash = job.PayloadHash, payload = detail.Payload, reconcileOnly, retryAuthorized = detail.RetryAuthorized });
});
app.MapPost("/api/connector/jobs/{id}/sending", async (string id, ConnectorJobSending input, HttpContext ctx, DispatchDb db) =>
{
    var c = await Auth.Connector(ctx, db); if (!deployment.PostingSupported || c.Environment != "Production" || c.ExpectedCompany != deployment.ExactTallyCompany) throw new RuleException("Invoice posting requires this site's exact production company.", 403);
    await using var tx = await db.Database.BeginTransactionAsync();
    await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({c.CompanyId},0))");
    var job = await db.Jobs.SingleOrDefaultAsync(x => x.CompanyId == c.CompanyId && x.Id == id) ?? throw new RuleException("Invoice job not found.", 404);
    if (job.State == "Sending" && job.ConnectorId == c.Id && job.PayloadHash == input.PayloadHash) return Results.Ok(new { accepted = true, state = job.State, reconcileOnly = true });
    var authorizedUnknownRetry = job.State == "ConfirmationUnknown" && TallyJobDetails.Read(job.Detail).RetryAuthorized;
    if ((job.State != "Claimed" && !authorizedUnknownRetry) || job.ConnectorId != c.Id || job.LeaseExpires <= DateTimeOffset.UtcNow || job.PayloadHash != input.PayloadHash) throw new RuleException("Invoice claim is stale or its payload changed. Do not send.", 409);
    job.State = "Sending"; var detail = TallyJobDetails.Read(job.Detail); job.Detail = Json.Write(detail with { Message = "Tally has been asked to create this sales voucher; readback is required.", RetryAuthorized = false }); job.LeaseExpires = DateTimeOffset.UtcNow.AddMinutes(5); await db.SaveChangesAsync(); await tx.CommitAsync();
    return Results.Ok(new { accepted = true, state = job.State, reconcileOnly = false });
});
app.MapPost("/api/connector/jobs/{id}/result", async (string id, ConnectorJobOutcome input, HttpContext ctx, DispatchDb db) =>
{
    var c = await Auth.Connector(ctx, db); if (!deployment.PostingSupported || c.Environment != "Production" || c.ExpectedCompany != deployment.ExactTallyCompany) throw new RuleException("Invoice posting requires this site's exact production company.", 403);
    var job = await db.Jobs.SingleOrDefaultAsync(x => x.CompanyId == c.CompanyId && x.Id == id) ?? throw new RuleException("Invoice job not found.", 404);
    if (job.PayloadHash != input.PayloadHash || job.ConnectorId != c.Id) throw new RuleException("Invoice result does not match the claimed connector job.", 409);
    var detail = TallyJobDetails.Read(job.Detail); if (detail.Payload == null) throw new RuleException("Invoice payload is unavailable.", 409);
    if (input.State == "Confirmed")
    {
        if (job.State == "Confirmed") return Results.Ok(new { state = job.State, voucherReference = job.VoucherReference, message = "Previously confirmed result retained." });
        TallyJobValidation.ValidateReadback(detail.Payload, input.Readback);
        job.State = "Confirmed"; job.VoucherReference = input.Readback!.VoucherNumber;
        job.Detail = Json.Write(new TallyInvoiceJobDetail("Tally invoice created and verified by exact-reference readback.", detail.Payload, input.Readback));
        var shipment = await db.Shipments.SingleAsync(x => x.CompanyId == c.CompanyId && x.Id == job.ShipmentId);
        var documents = JsonSerializer.Deserialize<Dictionary<string, object?>>(shipment.Documents, Json.Options) ?? new Dictionary<string, object?>();
        documents["print"] = "Prepared"; documents["confirmedVoucher"] = input.Readback.VoucherNumber; documents["tallyInvoice"] = input.Readback;
        shipment.Documents = Json.Write(documents);
        var audit = new AuditEvent { CompanyId = c.CompanyId, Workflow = shipment.Workflow, ActorId = c.Id, Action = "tallyInvoiceConfirmed", EntityId = shipment.Id, Data = Json.Write(new { job.Id, input.Readback.VoucherNumber, input.Readback.Date, input.Readback.Total }) };
        db.Audit.Add(audit); db.Outbox.Add(new OutboxEvent { CompanyId = c.CompanyId, AuditId = audit.Id });
    }
    else
    {
        if (input.State is not ("Rejected" or "ConfirmationUnknown" or "NeedsReview")) throw new RuleException("Unsupported invoice result state.");
        if (job.State == "Confirmed") throw new RuleException("A confirmed invoice cannot be downgraded.", 409);
        job.State = input.State; job.Detail = Json.Write(new TallyInvoiceJobDetail(input.Detail ?? "Tally result requires operator reconciliation. No automatic resend will occur.", detail.Payload)); job.LeaseExpires = null;
    }
    await db.SaveChangesAsync();
    return Results.Ok(new { state = job.State, voucherReference = job.VoucherReference, message = job.Detail });
});
app.MapGet("/api/documents/invoice/{id}", async (string id, HttpContext ctx, DispatchDb db) =>
{
    var (u, _) = await Auth.User(ctx, db); if (!deployment.PostingSupported) throw new RuleException("Invoice documents require a configured company.", 403);
    var shipment = await db.Shipments.SingleOrDefaultAsync(x => x.CompanyId == u.CompanyId && x.Id == id) ?? throw new RuleException("Shipment unavailable.", 404);
    var job = shipment.InvoiceJobId == null ? null : await db.Jobs.SingleOrDefaultAsync(x => x.CompanyId == u.CompanyId && x.Id == shipment.InvoiceJobId);
    if (job == null || job.State != "Confirmed") throw new RuleException("A Tally-confirmed invoice is not available to print.", 409);
    var detail = TallyJobDetails.Read(job.Detail); if (detail.Result == null) throw new RuleException("Tally invoice readback details are unavailable.", 409);
    var demoTaxSetup = new[] { detail.Payload?.CgstLedger, detail.Payload?.SgstLedger, detail.Payload?.IgstLedger }
        .Any(name => name?.Contains("DEMO", StringComparison.OrdinalIgnoreCase) == true);
    var order = shipment.OrderId == null ? null : await db.Orders.Where(x => x.Id == shipment.OrderId && x.CompanyId == u.CompanyId).Select(x => new { x.Reference, x.CreatedAt, x.Destination }).SingleOrDefaultAsync();
    return Results.Ok(new { documentType = "Tally-confirmed sales invoice", demoTaxSetup, shipment, order, customer = await db.Customers.SingleAsync(x => x.Id == shipment.CustomerId && x.CompanyId == u.CompanyId), trip = await db.Trips.SingleAsync(x => x.Id == shipment.TripId && x.CompanyId == u.CompanyId), billing = await db.Billings.SingleAsync(x => x.Id == job.BillingId && x.CompanyId == u.CompanyId), invoice = detail.Result });
});
app.MapFallbackToFile("index.html");
await app.RunAsync();

static bool HasDemoTaxLedgers(string snapshot)
{
    try
    {
        var catalog = Json.Read<TallyMasterSnapshot>(snapshot);
        return TallyTaxLedgerResolver.Resolve(catalog, demo: true) != null
            && TallyTaxLedgerResolver.Resolve(catalog, demo: false) == null;
    }
    catch (System.Text.Json.JsonException) { return true; }
}

static bool HasProductionInvoiceSetup(string snapshot)
{
    try
    {
        var catalog = Json.Read<TallyMasterSnapshot>(snapshot);
        if (catalog is null || catalog.Items is not { Length: > 0 } || catalog.Ledgers is null) return false;
        return TallyTaxLedgerResolver.Resolve(catalog, demo: false) != null
                && catalog.Items.All(x => !string.IsNullOrWhiteSpace(x.HsnCode) && x.GstRate is >= 0 and <= 100)
            && !string.IsNullOrWhiteSpace(catalog.CompanyState)
            && catalog.Ledgers.Any(x => string.Equals(x.Group, "Sundry Debtors", StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrWhiteSpace(x.StateName));
    }
    catch (System.Text.Json.JsonException) { return false; }
}

record Login(string Email, string Password);
record Heartbeat(string Company, string Environment, bool TallyReachable, string Version, string Detail);
record ProductionUpgrade(string Company, bool ConfirmProduction);
record MasterSnapshot(string Company, string Environment, TallyStockItem[] Items, TallyLedger[] Ledgers, string? CompanyState = null);
record ConnectorJobSending(string PayloadHash);
record ConnectorJobOutcome(string PayloadHash, string State, string? Detail, TallyInvoiceReadback? Readback);
static class TallyJobDetails
{
    public static TallyInvoiceJobDetail Read(string raw)
    {
        try { return Json.Read<TallyInvoiceJobDetail>(raw); }
        catch (System.Text.Json.JsonException) { return new TallyInvoiceJobDetail(raw); }
    }
    public static string WithMessage(string raw, string message)
    {
        var detail = Read(raw); return Json.Write(detail with { Message = message });
    }
}
static class TallyJobValidation
{
    public static void ValidateReadback(TallyInvoicePayload payload, TallyInvoiceReadback? result)
    {
        if (result == null || string.IsNullOrWhiteSpace(result.VoucherNumber)) throw new RuleException("Tally did not return a voucher number.", 409);
        if (result.Company != payload.Company || result.VoucherType != payload.VoucherType || result.Date != payload.Date || result.Reference != payload.Reference || result.PartyLedgerName != payload.PartyLedgerName)
            throw new RuleException("Tally readback identity does not match the immutable dispatch invoice.", 409);
        static bool Same(decimal actual, decimal expected) => decimal.Abs(actual - expected) <= 0.02m;
        if (!Same(result.Taxable, payload.Taxable) || !Same(result.Cgst, payload.Cgst) || !Same(result.Sgst, payload.Sgst) || !Same(result.Igst, payload.Igst) || !Same(result.Total, payload.Total))
            throw new RuleException("Tally readback totals differ from the approved dispatch invoice. Reconciliation is required; do not resend.", 409);
        if (result.Lines.Length != payload.Lines.Length) throw new RuleException("Tally readback line count differs from the approved dispatch invoice.", 409);
        foreach (var expected in payload.Lines)
        {
            var actual = result.Lines.SingleOrDefault(x => x.StockItemName == expected.StockItemName && x.Unit == expected.Unit);
            if (actual == null || actual.Quantity != expected.Quantity || !Same(actual.Rate, expected.Rate) || !Same(actual.DiscountPercent, expected.DiscountPercent) || !Same(actual.Amount, expected.Amount) || actual.HsnCode != expected.HsnCode || actual.GstRate != expected.GstRate)
                throw new RuleException($"Tally readback did not match SKU {expected.Sku}. Reconciliation is required; do not resend.", 409);
        }
    }
}
static class TallyLedgerOptions
{
    public static object[] Read(string raw)
    {
        try
        {
            var snapshot = Json.Read<TallyMasterSnapshot>(raw);
            return (snapshot?.Ledgers ?? []).Where(x => x is not null && (x.Group == "Sales Accounts" || x.Group == "Duties & Taxes"))
                .Select(x => new { x.Name, x.Group }).Distinct().ToArray();
        }
        catch (System.Text.Json.JsonException) { return []; }
    }
}
static class Auth
{
    public static async Task<(User, Session)> User(HttpContext ctx, DispatchDb db, bool mutation = false)
    {
        var token = ctx.Request.Cookies["dispatch_session"]; if (token == null || token.Length != 64) throw new RuleException("Sign in to continue.", 401); var hash = Operations.Hash(token); var s = await db.Sessions.SingleOrDefaultAsync(x => x.TokenHash == hash && x.Expires > DateTimeOffset.UtcNow) ?? throw new RuleException("Session expired. Sign in again.", 401); var u = await db.Users.SingleOrDefaultAsync(x => x.Id == s.UserId && x.CompanyId == s.CompanyId && x.Active) ?? throw new RuleException("Account disabled.", 401);
        var site = ctx.RequestServices.GetRequiredService<DeploymentScope>().Site;
        if (site != null && u.CompanyId != site.CompanyId) throw new RuleException("Account unavailable on this company's website.", 401);
        if (mutation && ctx.Request.Headers["X-CSRF-Token"] != s.Csrf) throw new RuleException("Security token missing. Refresh and sign in again.", 403); return (u, s);
    }
    public static async Task<Connector> Connector(HttpContext ctx, DispatchDb db)
    {
        var id = ctx.Request.Headers["X-Connector-Id"].ToString(); var secret = ctx.Request.Headers["X-Connector-Key"].ToString(); if (secret.Length != 64) throw new RuleException("Invalid connector credential.", 401); var c = await db.Connectors.SingleOrDefaultAsync(x => x.Id == id && !x.Revoked) ?? throw new RuleException("Connector is revoked or unknown.", 401); var site = ctx.RequestServices.GetRequiredService<DeploymentScope>().Site; if (site != null && c.CompanyId != site.CompanyId) throw new RuleException("Connector unavailable on this company's website.", 401); if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(c.SecretHash), Convert.FromHexString(Operations.Hash(secret)))) throw new RuleException("Invalid connector credential.", 401); return c;
    }
}
public partial class Program;
