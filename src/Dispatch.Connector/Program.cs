using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
var folder = Path.Combine(appData, "ElectroGroup", "DispatchConnector");
// Reuse an existing protected store so a branding change cannot lose a pending invoice journal.
var legacyFolder = Path.Combine(appData, "Kriyantha", "DispatchConnector");
if (!Directory.Exists(folder) && Directory.Exists(legacyFolder)) folder = legacyFolder;
var profileIndex = Array.IndexOf(args, "--profile");
string? profile = profileIndex >= 0 ? args.ElementAtOrDefault(profileIndex + 1) : "electro";
if (profile is not ("electro" or "aromazon")) throw new InvalidOperationException("Use --profile electro or --profile aromazon.");
var profileFolder = Path.Combine(appData, "DispatchCompanies", profile, "DispatchConnector");
// Electro already has paired diagnostic connectors in the original per-user store. Copy its
// config and DPAPI-protected credential into the isolated Electro profile when upgrading, so
// auto-sync can start without a second pairing while the old diagnostics process is still live.
// Aromazen keeps its isolated profile store and never reads the Electro credential.
if (profile == "electro" && !Directory.Exists(profileFolder))
{
    var existingPair = new[] { folder, legacyFolder }.FirstOrDefault(path =>
        File.Exists(Path.Combine(path, "config.json")) && File.Exists(Path.Combine(path, "credential.dpapi")));
    if (existingPair != null)
    {
        Directory.CreateDirectory(profileFolder);
        File.Copy(Path.Combine(existingPair, "config.json"), Path.Combine(profileFolder, "config.json"));
        File.Copy(Path.Combine(existingPair, "credential.dpapi"), Path.Combine(profileFolder, "credential.dpapi"));
    }
}
folder = profileFolder;
if (args.Contains("--self-test")) { ConnectorTests.Run(); return; }
if (args.Contains("--pair"))
{
    if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Pairing uses Windows DPAPI.");
    Directory.CreateDirectory(folder); Console.Write("Cloud HTTPS URL: "); var cloud = Console.ReadLine()!.Trim(); if (!Uri.TryCreate(cloud, UriKind.Absolute, out var uri) || uri.Scheme != "https") throw new InvalidOperationException("HTTPS required.");
    if (profile != null) {
        using var check = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        var configuredSite = await check.GetFromJsonAsync<JsonElement>(new Uri(uri, "/api/site"));
        if (configuredSite.GetProperty("slug").GetString() != profile) throw new InvalidOperationException("The website belongs to the other company. Pairing stopped.");
    }
    Console.Write("Connector ID: "); var id = Console.ReadLine()!.Trim(); Console.Write("Exact Tally company: "); var company = Console.ReadLine()!.Trim(); Console.Write("Tally loopback endpoint [http://127.0.0.1:9000]: "); var endpoint = Console.ReadLine(); endpoint = string.IsNullOrWhiteSpace(endpoint) ? "http://127.0.0.1:9000" : endpoint.Trim(); if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var tally) || !tally.IsLoopback) throw new InvalidOperationException("This stage permits loopback Tally only. A restricted LAN policy needs explicit implementation.");
    Console.Write("Pairing key (hidden): "); var secret = new StringBuilder(); ConsoleKeyInfo key; while ((key = Console.ReadKey(true)).Key != ConsoleKey.Enter) { if (key.Key == ConsoleKey.Backspace) { if (secret.Length > 0) secret.Length--; } else if (!char.IsControl(key.KeyChar)) secret.Append(key.KeyChar); }
    Console.WriteLine(); if (secret.Length != 64) throw new InvalidOperationException("Pairing key must be 64 hex characters.");
    var config = new ConnectorConfig(cloud, id, company, "Production", endpoint); await File.WriteAllTextAsync(Path.Combine(folder, "config.json"), JsonSerializer.Serialize(config)); await File.WriteAllBytesAsync(Path.Combine(folder, "credential.dpapi"), ProtectedData.Protect(Encoding.UTF8.GetBytes(secret.ToString()), null, DataProtectionScope.CurrentUser)); Console.WriteLine("Paired for the exact company production connection."); return;
}
var diagnosticsOnly = args.Contains("--diagnostics-only");
var builder = Host.CreateApplicationBuilder(args.Where(a => a != "--diagnostics-only").ToArray()); builder.Services.AddWindowsService(o => o.ServiceName = profile == null ? "Electro Group Dispatch Connector" : "Dispatch Connector - " + profile); builder.Services.AddSingleton(new ConnectorStorage(folder, diagnosticsOnly)); builder.Services.AddHostedService<ConnectorWorker>(); await builder.Build().RunAsync();

record ConnectorConfig(string Cloud, string ConnectorId, string Company, string Environment, string TallyEndpoint);
record ConnectorStorage(string Folder, bool DiagnosticsOnly = false);
static class ConnectorMode
{
    public static bool AllowsEnvironment(string environment, bool diagnosticsOnly) => environment == "Production" || (environment == "Test" && diagnosticsOnly);
    public static bool AllowsAccounting(string environment, bool diagnosticsOnly) => environment == "Production" && !diagnosticsOnly;
}
record ConnectorJobEnvelope(string JobId, string PayloadHash, TallyInvoicePayload Payload, bool ReconcileOnly, bool RetryAuthorized = false);
record SendingAck(bool Accepted, string State, bool ReconcileOnly);
record TallyImportResult(int Created, int Errors, string LineError);
sealed class ConnectorWorker(ConnectorStorage storage, ILogger<ConnectorWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!OperatingSystem.IsWindows()) { logger.LogError("Run this connector on the separate Windows Tally computer."); return; }
        var configPath = Path.Combine(storage.Folder, "config.json");
        var config = JsonSerializer.Deserialize<ConnectorConfig>(await File.ReadAllTextAsync(configPath, stoppingToken))!;
        if (config.Environment == "Test" && config.Company == "ELECTRO GROUP OF INDUSTRIES")
        {
            config = config with { Environment = "Production" };
            await File.WriteAllTextAsync(configPath, JsonSerializer.Serialize(config), stoppingToken);
            logger.LogInformation("Upgraded the existing Electro pairing to the production connection profile.");
        }
        if (new Uri(config.Cloud).Scheme != "https" || !new Uri(config.TallyEndpoint).IsLoopback || !ConnectorMode.AllowsEnvironment(config.Environment, storage.DiagnosticsOnly)) throw new InvalidOperationException("Connector environment policy failed. A Test profile requires --diagnostics-only and cannot process accounting work.");
        var secret = Encoding.UTF8.GetString(ProtectedData.Unprotect(await File.ReadAllBytesAsync(Path.Combine(storage.Folder, "credential.dpapi"), stoppingToken), null, DataProtectionScope.CurrentUser));
        using var processLock = new FileStream(Path.Combine(storage.Folder, "connector.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        using var cloud = new HttpClient { BaseAddress = new Uri(config.Cloud), Timeout = TimeSpan.FromSeconds(20) }; cloud.DefaultRequestHeaders.Add("X-Connector-Id", config.ConnectorId); cloud.DefaultRequestHeaders.Add("X-Connector-Key", secret);
        using var siteResponse = await cloud.GetAsync("/api/site", stoppingToken); siteResponse.EnsureSuccessStatusCode();
        using var siteDoc = JsonDocument.Parse(await siteResponse.Content.ReadAsStringAsync(stoppingToken));
        var siteInfo = siteDoc.RootElement; var siteSlug = siteInfo.ValueKind == JsonValueKind.Object && siteInfo.TryGetProperty("slug", out var slug) ? slug.GetString() : null; var electroMasterSync = siteSlug is "electro" or "aromazon";
        if (config.Environment == "Test" && siteSlug != "aromazon") throw new InvalidOperationException("Test diagnostics are supported only for the isolated AROMAZEN site.");
        var accountingEnabled = ConnectorMode.AllowsAccounting(config.Environment, storage.DiagnosticsOnly);
        logger.LogInformation("Company master sync enabled={MasterSync}.", electroMasterSync && accountingEnabled);
        if (!accountingEnabled) logger.LogInformation("Diagnostics only: exact company checks and heartbeat. No master synchronization or invoice jobs will run.");
        using var tally = new HttpClient { Timeout = TimeSpan.FromSeconds(20), MaxResponseContentBufferSize = 4 * 1024 * 1024 }; var failures = 0; var lastMasterAttempt = DateTimeOffset.MinValue;
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                var reachable = false; var detail = ""; try
                {
                    using var response = await tally.PostAsync(config.TallyEndpoint, new StringContent(TallyXml.CompanyProbe(config.Company), Encoding.UTF8, "text/xml"), stoppingToken); response.EnsureSuccessStatusCode(); var xml = TallyXml.Parse(await response.Content.ReadAsStringAsync(stoppingToken));
                    var companyNode = xml.Descendants("COMPANY").FirstOrDefault(x => string.Equals((string?)x.Attribute("NAME") ?? (string?)x.Element("NAME"), config.Company, StringComparison.Ordinal));
                    reachable = companyNode != null; detail = reachable ? "Exact expected company found. Master sync is active; production invoice mapping and readback must be accountant-checked." : "Expected company not exported. Open the exact company and check integration permissions/port.";
                    if (reachable && !accountingEnabled) detail = "Exact expected company found. Diagnostics only; master synchronization and invoice posting are disabled.";
                    if (reachable && accountingEnabled && electroMasterSync && DateTimeOffset.UtcNow - lastMasterAttempt > TimeSpan.FromMinutes(2))
                    {
                        lastMasterAttempt = DateTimeOffset.UtcNow;
                        logger.LogInformation("Reading Tally stock items and customer ledgers for automatic master sync.");
                        try
                        {
                            var stockXml = await RequestMasters(tally, config, "StockItem", stoppingToken);
                            var ledgerXml = await RequestMasters(tally, config, "Ledger", stoppingToken);
                            var items = TallyXml.ReadItems(stockXml)
                                .Where(x => !x.Name.StartsWith("ARCHIVE - UNUSED -", StringComparison.OrdinalIgnoreCase))
                                .ToArray();
                            var ledgers = TallyXml.ReadLedgers(ledgerXml);
                            var companyState = companyNode?.Descendants().FirstOrDefault(x => x.Name.LocalName.Equals("STATENAME", StringComparison.OrdinalIgnoreCase))?.Value.Trim();
                            using var reply = await cloud.PostAsJsonAsync("/api/connector/masters", new { company = config.Company, environment = config.Environment, items, ledgers, companyState }, stoppingToken);
                            reply.EnsureSuccessStatusCode();
                            detail += $" Dispatch master data refreshed automatically from Tally: {items.Length} stock items (including standard selling prices), {ledgers.Length} ledgers.";
                            logger.LogInformation("Automatic master sync succeeded: {StockItems} stock items, {LedgerCount} ledgers.", items.Length, ledgers.Length);
                        }
                        catch (Exception ex) when ((ex is HttpRequestException or TaskCanceledException or XmlException or InvalidOperationException or FormatException) && !stoppingToken.IsCancellationRequested)
                        {
                            detail += " Tally is reachable, but master export could not be read or staged. No records were changed.";
                            logger.LogWarning("Automatic master sync failed ({ExceptionType}): {Error}", ex.GetType().Name, ex.Message);
                        }
                    }
                }
                catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or XmlException or InvalidOperationException or FormatException) { detail = "Tally is stopped, integration unavailable, response unsafe or endpoint timed out. No accounting request was sent."; }
                try { using var reply = await cloud.PostAsJsonAsync("/api/connector/heartbeat", new { company = config.Company, environment = config.Environment, tallyReachable = reachable, version = siteSlug == "aromazon" ? "1.8.0-company-dispatch" : "1.7.0-electro-charges", detail }, stoppingToken); reply.EnsureSuccessStatusCode(); failures = 0; logger.LogInformation("Heartbeat delivered. Tally reachable={Reachable}.", reachable); } catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException) { failures = Math.Min(failures + 1, 5); logger.LogWarning("Cloud heartbeat failed. Reconnecting with bounded backoff."); }
                if (reachable && accountingEnabled && electroMasterSync)
                {
                    try { await ProcessNextInvoiceJob(cloud, tally, config, stoppingToken); }
                    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or XmlException or InvalidOperationException or FormatException or JsonException or IOException or UnauthorizedAccessException)
                    { logger.LogWarning("Invoice job stopped for safe reconciliation ({ExceptionType}): {Error}", ex.GetType().Name, ex.Message); }
                }
                await Task.Delay(TimeSpan.FromSeconds(Math.Min(120, 15 * Math.Pow(2, failures))), stoppingToken);
            }
        }
        finally { processLock.Flush(true); }
    }
    static async Task<string> RequestMasters(HttpClient tally, ConnectorConfig config, string kind, CancellationToken token)
    {
        using var response = await tally.PostAsync(config.TallyEndpoint, new StringContent(TallyXml.MasterProbe(config.Company, kind), Encoding.UTF8, "text/xml"), token);
        response.EnsureSuccessStatusCode(); return await response.Content.ReadAsStringAsync(token);
    }
    async Task ProcessNextInvoiceJob(HttpClient cloud, HttpClient tally, ConnectorConfig config, CancellationToken token)
    {
        using var claimResponse = await cloud.GetAsync("/api/connector/jobs/next", token);
        if (claimResponse.StatusCode == System.Net.HttpStatusCode.NoContent) return;
        claimResponse.EnsureSuccessStatusCode();
        var job = await claimResponse.Content.ReadFromJsonAsync<ConnectorJobEnvelope>(cancellationToken: token) ?? throw new InvalidOperationException("Empty invoice claim response.");
        if (config.Environment != "Production" || job.Payload.Environment != "Production" || job.Payload.Company != config.Company || job.Payload.JobId != job.JobId || !Guid.TryParse(job.JobId, out _))
            throw new InvalidOperationException("Invoice job escaped the expected Electro company production scope.");
        if (OperationsHash(job.Payload) != job.PayloadHash) throw new InvalidOperationException("Invoice payload hash changed after queueing.");

        var journal = new AttemptJournal(Path.Combine(storage.Folder, "attempts"));
        var attemptPath = Path.Combine(storage.Folder, "attempts", job.JobId + ".json");
        Attempt? previous = File.Exists(attemptPath) ? journal.Read(job.JobId) : null;
        if (previous != null && previous.PayloadHash != job.PayloadHash) throw new InvalidOperationException("The local attempt journal has a different immutable invoice payload.");

        var existing = await ReadBackByReference(tally, config, job.Payload, token);
        if (existing.Length > 1)
        {
            var unsafeAttempt = previous ?? new Attempt(job.JobId, job.PayloadHash, "Prepared");
            if (unsafeAttempt.State == "Prepared") journal.Write(unsafeAttempt);
            if (unsafeAttempt.State is "Prepared" or "Sending" or "ConfirmationUnknown") journal.Write(unsafeAttempt with { State = "NeedsReview" });
            await ReportJobOutcome(cloud, job, "NeedsReview", "More than one Tally voucher contains the dispatch reference. No voucher was sent.", null, token);
            return;
        }
        if (existing.Length == 1)
        {
            await ValidateCurrentTallyMasters(tally, config, job.Payload, token, checkBalance: false);
            ValidateReadback(job.Payload, existing[0]);
            var recovered = previous ?? new Attempt(job.JobId, job.PayloadHash, "Prepared");
            if (previous == null) journal.Write(recovered);
            if (recovered.State != "Confirmed") journal.Write(recovered with { State = "Confirmed", VoucherReference = existing[0].VoucherNumber });
            await ReportJobOutcome(cloud, job, "Confirmed", "Found and verified the existing Tally voucher by its dispatch reference.", existing[0], token);
            return;
        }

        var unresolvedAttempt = previous?.State is "Sending" or "ConfirmationUnknown" or "NeedsReview" or "Confirmed" or "Rejected";
        if (job.ReconcileOnly || (unresolvedAttempt && !job.RetryAuthorized))
        {
            var uncertain = previous ?? new Attempt(job.JobId, job.PayloadHash, "Sending");
            if (previous == null) journal.Write(uncertain);
            if (uncertain.State is "Sending" or "Prepared") journal.Write(uncertain with { State = "ConfirmationUnknown" });
            await ReportJobOutcome(cloud, job, "ConfirmationUnknown", "No voucher is visible yet. Tally will be checked again; the connector will not resend this invoice automatically.", null, token);
            return;
        }

        if (previous?.State == "ConfirmationUnknown" && job.RetryAuthorized)
        {
            previous = previous with { State = "RetryAuthorized" };
            journal.Write(previous);
        }

        var currentCompany = TallyXml.Parse(await PostTally(tally, TallyXml.CompanyProbe(config.Company), token));
        var currentNames = currentCompany.Descendants("COMPANY").Select(x => (string?)x.Attribute("NAME") ?? (string?)x.Element("NAME")).Where(x => x != null).ToArray();
        if (!currentNames.Contains(config.Company, StringComparer.Ordinal)) throw new InvalidOperationException("The exact Tally company is no longer active. Invoice not sent.");
        await ValidateCurrentTallyMasters(tally, config, job.Payload, token);

        var prepared = previous ?? new Attempt(job.JobId, job.PayloadHash, "Prepared");
        if (previous == null) journal.Write(prepared);
        using (var sending = await cloud.PostAsJsonAsync($"/api/connector/jobs/{job.JobId}/sending", new { payloadHash = job.PayloadHash }, token))
        {
            sending.EnsureSuccessStatusCode();
            var confirmation = await sending.Content.ReadFromJsonAsync<SendingAck>(cancellationToken: token);
            if (confirmation?.ReconcileOnly == true)
            {
                journal.Write(prepared with { State = "Sending" });
                await ReportJobOutcome(cloud, job, "ConfirmationUnknown", "The server already marked this invoice as sending. Reconciliation only; no resend.", null, token);
                return;
            }
        }
        journal.Write(prepared with { State = "Sending" });
        try
        {
            var responseXml = await PostTally(tally, TallyXml.CreateSalesInvoice(job.Payload), token);
            var imported = TallyXml.ReadImportResult(responseXml);
            if (imported.Errors > 0 || imported.Created != 1)
            {
                journal.Write(new Attempt(job.JobId, job.PayloadHash, "Rejected"));
                await ReportJobOutcome(cloud, job, "Rejected", "Tally rejected the sales invoice: " + imported.LineError, null, token);
                return;
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or XmlException)
        {
            journal.Write(new Attempt(job.JobId, job.PayloadHash, "ConfirmationUnknown"));
            await ReportJobOutcome(cloud, job, "ConfirmationUnknown", "Tally response was interrupted. The same reference will be read back; this invoice will not be resent automatically.", null, token);
            return;
        }

        var readback = await ReadBackByReference(tally, config, job.Payload, token);
        if (readback.Length != 1)
        {
            journal.Write(new Attempt(job.JobId, job.PayloadHash, "ConfirmationUnknown"));
            await ReportJobOutcome(cloud, job, "ConfirmationUnknown", "Tally accepted the import response, but exact-reference readback is not yet conclusive. No resend will occur.", null, token);
            return;
        }
        await ValidateCurrentTallyMasters(tally, config, job.Payload, token, checkBalance: false);
        try { ValidateReadback(job.Payload, readback[0]); }
        catch (InvalidOperationException ex)
        {
            journal.Write(new Attempt(job.JobId, job.PayloadHash, "NeedsReview"));
            await ReportJobOutcome(cloud, job, "NeedsReview", ex.Message, readback[0], token);
            return;
        }
        journal.Write(new Attempt(job.JobId, job.PayloadHash, "Confirmed", readback[0].VoucherNumber));
        await ReportJobOutcome(cloud, job, "Confirmed", "Tally invoice created and verified by exact-reference readback.", readback[0], token);
    }
    async Task ValidateCurrentTallyMasters(HttpClient tally, ConnectorConfig config, TallyInvoicePayload payload, CancellationToken token, bool checkBalance = true)
    {
        var stock = TallyXml.ReadItems(await RequestMasters(tally, config, "StockItem", token));
        var ledgers = TallyXml.ReadLedgers(await RequestMasters(tally, config, "Ledger", token));
        foreach (var line in payload.Lines)
        {
            var item = stock.SingleOrDefault(x => x.NativeId == line.NativeId);
            if (item == null || item.Name != line.StockItemName || item.Unit != line.Unit || item.HsnCode != line.HsnCode || item.GstRate != line.GstRate || (checkBalance && item.Balance < line.Quantity))
                throw new InvalidOperationException($"Current Tally item {line.StockItemName} differs from the approved invoice or has insufficient stock.");
        }
        if (!ledgers.Any(x => x.Name == payload.PartyLedgerName && x.Group == "Sundry Debtors" && x.StateName == payload.PartyState) ||
            !ledgers.Any(x => x.Name == payload.SalesLedger && x.Group == "Sales Accounts") ||
            (payload.Freight + payload.OtherCharges > 0 && !ledgers.Any(x => x.Name == payload.ChargeLedger)) ||
            !ledgers.Any(x => x.Name == payload.CgstLedger && x.Group == "Duties & Taxes") ||
            !ledgers.Any(x => x.Name == payload.SgstLedger && x.Group == "Duties & Taxes") ||
            !ledgers.Any(x => x.Name == payload.IgstLedger && x.Group == "Duties & Taxes"))
            throw new InvalidOperationException("A required party, sales or tax ledger changed in Tally. Invoice not sent.");
    }
    static async Task<string> PostTally(HttpClient tally, string xml, CancellationToken token)
    {
        using var response = await tally.PostAsync("http://127.0.0.1:9000", new StringContent(xml, Encoding.UTF8, "text/xml"), token);
        response.EnsureSuccessStatusCode(); return await response.Content.ReadAsStringAsync(token);
    }
    async Task<TallyInvoiceReadback[]> ReadBackByReference(HttpClient tally, ConnectorConfig config, TallyInvoicePayload payload, CancellationToken token)
    {
        var xml = await PostTally(tally, TallyXml.DayBookProbe(config.Company, payload.Date), token);
        return TallyXml.ReadInvoiceReadbacks(xml, payload).Where(x => x.Reference == payload.Reference).ToArray();
    }
    async Task ReportJobOutcome(HttpClient cloud, ConnectorJobEnvelope job, string state, string detail, TallyInvoiceReadback? readback, CancellationToken token)
    {
        using var response = await cloud.PostAsJsonAsync($"/api/connector/jobs/{job.JobId}/result", new { payloadHash = job.PayloadHash, state, detail, readback }, token);
        response.EnsureSuccessStatusCode();
    }
    static readonly JsonSerializerOptions PayloadJsonOptions = new(JsonSerializerDefaults.Web);
    static string OperationsHash(TallyInvoicePayload payload) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, PayloadJsonOptions))));
    static void ValidateReadback(TallyInvoicePayload payload, TallyInvoiceReadback readback)
    {
        if (readback.Company != payload.Company || readback.VoucherType != payload.VoucherType || readback.Date != payload.Date || readback.Reference != payload.Reference || readback.PartyLedgerName != payload.PartyLedgerName || string.IsNullOrWhiteSpace(readback.VoucherNumber))
            throw new InvalidOperationException("Tally invoice identity did not match the immutable dispatch payload.");
        static bool Same(decimal a, decimal b) => decimal.Abs(a - b) <= 0.02m;
        if (!Same(readback.Taxable, payload.Taxable) || !Same(readback.Cgst, payload.Cgst) || !Same(readback.Sgst, payload.Sgst) || !Same(readback.Igst, payload.Igst) || !Same(readback.Total, payload.Total) || readback.Lines.Length != payload.Lines.Length)
            throw new InvalidOperationException("Tally invoice totals differ from the dispatch payload.");
        foreach (var expected in payload.Lines)
        {
            var actual = readback.Lines.SingleOrDefault(x => x.StockItemName == expected.StockItemName && x.Unit == expected.Unit);
            if (actual == null || actual.Quantity != expected.Quantity || !Same(actual.Rate, expected.Rate) || !Same(actual.DiscountPercent, expected.DiscountPercent) || !Same(actual.Amount, expected.Amount) || actual.HsnCode != expected.HsnCode || actual.GstRate != expected.GstRate)
                throw new InvalidOperationException($"Tally readback did not match item {expected.StockItemName}.");
        }
    }
}
static class TallyXml
{
    public static string CompanyProbe(string company) => new XDocument(new XElement("ENVELOPE", new XElement("HEADER", new XElement("VERSION", 1), new XElement("TALLYREQUEST", "Export"), new XElement("TYPE", "Collection"), new XElement("ID", "ElectroGroupCompanyProbe")), new XElement("BODY", new XElement("DESC", new XElement("STATICVARIABLES", new XElement("SVCURRENTCOMPANY", company), new XElement("SVEXPORTFORMAT", "$$SysName:XML")), new XElement("TDL", new XElement("TDLMESSAGE", new XElement("COLLECTION", new XAttribute("NAME", "ElectroGroupCompanyProbe"), new XElement("TYPE", "Company"), new XElement("FETCH", "Name,GUID,StateName")))))))).ToString(SaveOptions.DisableFormatting);
    public static string MasterProbe(string company, string kind)
    {
        var item = kind == "StockItem";
        var collection = item ? "ElectroGroupStockItems" : "ElectroGroupCustomerLedgers";
        var fetch = item ? "Name,GUID,BaseUnits,ClosingBalance,HSNCode,HSNMasterName,GSTDetails,Parent,StandardPriceList" : "Name,GUID,Parent,Address,PartyGSTIN,GSTIN,LedgerStateName";
        return new XDocument(new XElement("ENVELOPE", new XElement("HEADER", new XElement("VERSION", 1), new XElement("TALLYREQUEST", "Export"), new XElement("TYPE", "Collection"), new XElement("ID", collection)),
            new XElement("BODY", new XElement("DESC", new XElement("STATICVARIABLES", new XElement("SVCURRENTCOMPANY", company), new XElement("SVEXPORTFORMAT", "$$SysName:XML")),
            new XElement("TDL", new XElement("TDLMESSAGE", new XElement("COLLECTION", new XAttribute("NAME", collection), new XElement("TYPE", kind), new XElement("FETCH", fetch)))))))).ToString(SaveOptions.DisableFormatting);
    }
    public static string CreateSalesInvoice(TallyInvoicePayload invoice)
    {
        var expectedReference = invoice.Reference.StartsWith("TEST-DISPATCH-", StringComparison.Ordinal) ? "TEST-DISPATCH-" + invoice.JobId : "DISPATCH-" + invoice.JobId;
        if (invoice.Environment != "Production" || !Guid.TryParse(invoice.JobId, out _) || invoice.Reference != expectedReference || invoice.Lines.Length is < 1 or > 100)
            throw new InvalidOperationException("Sales invoice payload failed scope validation.");
        static string Amount(decimal value) => value.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture);
        static string Quantity(decimal value, string unit) => value.ToString("0.######", System.Globalization.CultureInfo.InvariantCulture) + " " + unit;
        var voucher = new XElement("VOUCHER", new XAttribute("VCHTYPE", invoice.VoucherType), new XAttribute("ACTION", "Create"), new XAttribute("OBJVIEW", "Invoice Voucher View"),
            new XElement("DATE", invoice.Date), new XElement("VOUCHERTYPENAME", invoice.VoucherType), new XElement("PERSISTEDVIEW", "Invoice Voucher View"),
            new XElement("ISINVOICE", "Yes"), new XElement("REFERENCE", invoice.Reference), new XElement("NARRATION", invoice.Narration),
            new XElement("PARTYLEDGERNAME", invoice.PartyLedgerName), new XElement("STATENAME", invoice.PartyState), new XElement("PLACEOFSUPPLY", invoice.PartyState),
            new XElement("ISGSTOVERRIDDEN", "No"), new XElement("LEDGERENTRIES.LIST", new XElement("LEDGERNAME", invoice.PartyLedgerName),
                new XElement("ISDEEMEDPOSITIVE", "Yes"), new XElement("ISPARTYLEDGER", "Yes"), new XElement("ISLASTDEEMEDPOSITIVE", "Yes"),
                new XElement("AMOUNT", Amount(-invoice.Total)), new XElement("BILLALLOCATIONS.LIST", new XElement("NAME", invoice.Reference), new XElement("BILLTYPE", "New Ref"), new XElement("AMOUNT", Amount(-invoice.Total)))));
        if (invoice.Cgst > 0) voucher.Add(new XElement("LEDGERENTRIES.LIST", new XElement("LEDGERNAME", invoice.CgstLedger), new XElement("ISDEEMEDPOSITIVE", "No"), new XElement("AMOUNT", Amount(invoice.Cgst))));
        if (invoice.Sgst > 0) voucher.Add(new XElement("LEDGERENTRIES.LIST", new XElement("LEDGERNAME", invoice.SgstLedger), new XElement("ISDEEMEDPOSITIVE", "No"), new XElement("AMOUNT", Amount(invoice.Sgst))));
        if (invoice.Igst > 0) voucher.Add(new XElement("LEDGERENTRIES.LIST", new XElement("LEDGERNAME", invoice.IgstLedger), new XElement("ISDEEMEDPOSITIVE", "No"), new XElement("AMOUNT", Amount(invoice.Igst))));
        var charges = invoice.Freight + invoice.OtherCharges;
        if (charges > 0) voucher.Add(new XElement("LEDGERENTRIES.LIST", new XElement("LEDGERNAME", invoice.ChargeLedger), new XElement("ISDEEMEDPOSITIVE", "No"), new XElement("AMOUNT", Amount(charges))));
        foreach (var line in invoice.Lines)
        {
            if (line.Quantity <= 0 || line.Rate < 0 || line.Amount < 0 || string.IsNullOrWhiteSpace(line.StockItemName) || string.IsNullOrWhiteSpace(line.HsnCode))
                throw new InvalidOperationException("Invoice line failed stock, HSN or amount validation.");
            var quantity = Quantity(line.Quantity, line.Unit);
            voucher.Add(new XElement("ALLINVENTORYENTRIES.LIST", new XElement("STOCKITEMNAME", line.StockItemName), new XElement("ISDEEMEDPOSITIVE", "No"),
                new XElement("RATE", Amount(line.Rate) + "/" + line.Unit), new XElement("DISCOUNT", Amount(line.DiscountPercent)), new XElement("AMOUNT", Amount(line.Amount)), new XElement("ACTUALQTY", quantity), new XElement("BILLEDQTY", quantity),
                new XElement("BATCHALLOCATIONS.LIST", new XElement("GODOWNNAME", invoice.GodownName), new XElement("BATCHNAME", "Primary Batch"), new XElement("DESTINATIONGODOWNNAME", invoice.GodownName),
                    new XElement("AMOUNT", Amount(line.Amount)), new XElement("ACTUALQTY", quantity), new XElement("BILLEDQTY", quantity)),
                new XElement("ACCOUNTINGALLOCATIONS.LIST", new XElement("LEDGERNAME", invoice.SalesLedger), new XElement("ISDEEMEDPOSITIVE", "No"), new XElement("AMOUNT", Amount(line.Amount)))));
        }
        return new XDocument(new XElement("ENVELOPE", new XElement("HEADER", new XElement("VERSION", 1), new XElement("TALLYREQUEST", "Import"), new XElement("TYPE", "Data"), new XElement("ID", "Vouchers")),
            new XElement("BODY", new XElement("DESC", new XElement("STATICVARIABLES", new XElement("SVCURRENTCOMPANY", invoice.Company))), new XElement("DATA", new XElement("TALLYMESSAGE", voucher))))).ToString(SaveOptions.DisableFormatting);
    }
    public static string DayBookProbe(string company, string date)
    {
        if (!DateTime.TryParseExact(date, "yyyyMMdd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var parsed))
            throw new InvalidOperationException("Invalid invoice date in the queued payload.");
        var tallyDate = parsed.ToString("d-MMM-yyyy", System.Globalization.CultureInfo.InvariantCulture);
        return new XDocument(new XElement("ENVELOPE", new XElement("HEADER", new XElement("VERSION", 1), new XElement("TALLYREQUEST", "Export"), new XElement("TYPE", "Data"), new XElement("ID", "DayBook")),
            new XElement("BODY", new XElement("DESC", new XElement("STATICVARIABLES", new XElement("SVCURRENTCOMPANY", company), new XElement("SVEXPORTFORMAT", "$$SysName:XML"),
                new XElement("SVFROMDATE", new XAttribute("TYPE", "Date"), tallyDate), new XElement("SVTODATE", new XAttribute("TYPE", "Date"), tallyDate)))))).ToString(SaveOptions.DisableFormatting);
    }
    public static TallyImportResult ReadImportResult(string xml)
    {
        var doc = Parse(xml); var errors = (int?)doc.Descendants().FirstOrDefault(x => x.Name.LocalName.Equals("ERRORS", StringComparison.OrdinalIgnoreCase)) ?? 0;
        var created = (int?)doc.Descendants().FirstOrDefault(x => x.Name.LocalName.Equals("CREATED", StringComparison.OrdinalIgnoreCase)) ?? 0;
        var lineError = doc.Descendants().FirstOrDefault(x => x.Name.LocalName.Equals("LINEERROR", StringComparison.OrdinalIgnoreCase))?.Value.Trim() ?? "";
        if (doc.Descendants().FirstOrDefault(x => x.Name.LocalName.Equals("STATUS", StringComparison.OrdinalIgnoreCase))?.Value == "0" && lineError.Length == 0)
            lineError = doc.Descendants().FirstOrDefault(x => x.Name.LocalName.Equals("DATA", StringComparison.OrdinalIgnoreCase))?.Value.Trim() ?? "Tally import failed.";
        return new TallyImportResult(created, errors, lineError);
    }
    public static TallyInvoiceReadback[] ReadInvoiceReadbacks(string xml, TallyInvoicePayload expected)
    {
        var doc = Parse(xml); var result = new List<TallyInvoiceReadback>();
        foreach (var voucher in doc.Descendants().Where(x => x.Name.LocalName.Equals("VOUCHER", StringComparison.OrdinalIgnoreCase) && x.Descendants().Any(y => y.Name.LocalName.Equals("VOUCHERTYPENAME", StringComparison.OrdinalIgnoreCase)))
            .Where(x => string.Equals(Value(x, "REFERENCE"), expected.Reference, StringComparison.Ordinal))
            .Where(x => !Value(x, "ISCANCELLED").Equals("Yes", StringComparison.OrdinalIgnoreCase) && !Value(x, "ISDELETED").Equals("Yes", StringComparison.OrdinalIgnoreCase)))
        {
            var entries = voucher.Descendants().Where(x => x.Name.LocalName.Equals("LEDGERENTRIES.LIST", StringComparison.OrdinalIgnoreCase) || x.Name.LocalName.Equals("ALLLEDGERENTRIES.LIST", StringComparison.OrdinalIgnoreCase)).ToArray();
            var inventory = voucher.Descendants().Where(x => x.Name.LocalName.Equals("ALLINVENTORYENTRIES.LIST", StringComparison.OrdinalIgnoreCase) && Value(x, "STOCKITEMNAME").Length > 0).ToArray();
            var lines = new List<TallyInvoiceLine>();
            foreach (var item in inventory)
            {
                var stockName = Value(item, "STOCKITEMNAME"); var match = expected.Lines.SingleOrDefault(x => x.StockItemName == stockName);
                if (match == null) continue;
                var billed = Value(item, "BILLEDQTY", "ACTUALQTY"); var quantity = Number(billed);
                var unit = billed.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).Skip(1).FirstOrDefault() ?? match.Unit;
                var amount = Math.Abs(Number(Value(item, "AMOUNT")));
                lines.Add(new TallyInvoiceLine(match.Sku, match.NativeId, stockName, unit, quantity, Number(Value(item, "RATE")), Number(Value(item, "DISCOUNT")), amount, match.GstRate, match.HsnCode, match.BookBalance));
            }
            decimal taxAmount(string token) => entries.Where(x => Value(x, "LEDGERNAME").Contains(token, StringComparison.OrdinalIgnoreCase)).Sum(x => Math.Abs(Number(Value(x, "AMOUNT"))));
            var inventoryTaxable = inventory.Sum(x => Math.Abs(Number(Value(x, "AMOUNT"))));
            var chargeTaxable = entries.Where(x => string.Equals(Value(x, "LEDGERNAME"), expected.ChargeLedger, StringComparison.OrdinalIgnoreCase)).Sum(x => Math.Abs(Number(Value(x, "AMOUNT"))));
            var taxable = inventoryTaxable + chargeTaxable; var cgst = taxAmount("CGST"); var sgst = taxAmount("SGST"); var igst = taxAmount("IGST");
            var party = Value(voucher, "PARTYLEDGERNAME"); if (party.Length == 0) party = entries.FirstOrDefault(x => Value(x, "ISPARTYLEDGER").Equals("Yes", StringComparison.OrdinalIgnoreCase)) is { } partyEntry ? Value(partyEntry, "LEDGERNAME") : "";
            result.Add(new TallyInvoiceReadback(expected.Company, Value(voucher, "VOUCHERTYPENAME"), Value(voucher, "VOUCHERNUMBER"), DateOnly(Value(voucher, "DATE")),
                Value(voucher, "REFERENCE"), party, lines.ToArray(), taxable, cgst, sgst, igst, taxable + cgst + sgst + igst));
        }
        return result.ToArray();
    }
    static string DateOnly(string value)
    {
        var digits = new string(value.Where(char.IsDigit).ToArray());
        if (digits.Length >= 8 && DateTime.TryParseExact(digits[..8], "yyyyMMdd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var date)) return date.ToString("yyyyMMdd", System.Globalization.CultureInfo.InvariantCulture);
        if (DateTime.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out date)) return date.ToString("yyyyMMdd", System.Globalization.CultureInfo.InvariantCulture);
        return value.Trim();
    }
    public static TallyItem[] ReadItems(string xml)
    {
        var doc = Parse(xml);
        return doc.Descendants().Where(x => x.Name.LocalName.Equals("STOCKITEM", StringComparison.OrdinalIgnoreCase)).Select(x => new TallyItem(
            Value(x, "GUID"), Value(x, "NAME"), Value(x, "BASEUNITS"), Number(Value(x, "CLOSINGBALANCE")), HsnCode(x), ClassificationRate(x) ?? GstRate(x), Value(x, "PARENT"), StandardSellingPrice(x), Value(x, "HSNMASTERNAME")))
            .Where(x => x.NativeId.Length > 0 && x.Name.Length > 0).Take(501).ToArray();
    }
    public static TallyLedger[] ReadLedgers(string xml)
    {
        var doc = Parse(xml);
        return doc.Descendants().Where(x => x.Name.LocalName.Equals("LEDGER", StringComparison.OrdinalIgnoreCase)).Select(x => new TallyLedger(
            Value(x, "GUID"), Value(x, "NAME"), Value(x, "PARENT"), string.Join(", ", x.Descendants().Where(a => a.Name.LocalName.Equals("ADDRESS", StringComparison.OrdinalIgnoreCase)).Select(a => a.Value.Trim()).Where(a => a.Length > 0).Distinct()), Value(x, "PARTYGSTIN", "GSTIN"), Value(x, "LEDGERSTATENAME", "STATENAME")))
            .Where(x => x.NativeId.Length > 0 && x.Name.Length > 0).Take(1001).ToArray();
    }
    static string Value(XElement parent, params string[] names)
    {
        var element = parent.DescendantsAndSelf().FirstOrDefault(x => names.Contains(x.Name.LocalName, StringComparer.OrdinalIgnoreCase));
        if (element != null) return element.Value.Trim();
        return parent.DescendantsAndSelf().Attributes().FirstOrDefault(x => names.Contains(x.Name.LocalName, StringComparer.OrdinalIgnoreCase))?.Value.Trim() ?? "";
    }
    static decimal Number(string value)
    {
        var match = System.Text.RegularExpressions.Regex.Match(value.Replace(",", ""), @"-?\d+(?:\.\d+)?");
        return match.Success && decimal.TryParse(match.Value, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var result) ? result : 0;
    }
    static decimal? StandardSellingPrice(XElement item)
    {
        var today = DateTime.Today;
        var prices = item.Descendants().Where(x => x.Name.LocalName.Equals("STANDARDPRICELIST.LIST", StringComparison.OrdinalIgnoreCase))
            .Select(x => (Date: TallyDate(Value(x, "DATE")), Rate: ParsedNumber(Value(x, "RATE"))))
            .Where(x => x.Rate is >= 0)
            .ToArray();
        var current = prices.Where(x => x.Date.HasValue && x.Date.Value.Date <= today)
            .OrderByDescending(x => x.Date).FirstOrDefault();
        if (current.Rate.HasValue) return current.Rate;
        if (prices.Any(x => !x.Date.HasValue)) return prices.Last(x => !x.Date.HasValue).Rate;
        return null;
    }
    static decimal? ParsedNumber(string value)
    {
        var match = System.Text.RegularExpressions.Regex.Match(value.Replace(",", ""), @"-?\d+(?:\.\d+)?");
        return match.Success && decimal.TryParse(match.Value, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var result) ? result : null;
    }
    static DateTime? TallyDate(string value)
    {
        value = value.Trim();
        if (value.Length == 8 && value.All(char.IsDigit))
        {
            var format = value.StartsWith("19", StringComparison.Ordinal) || value.StartsWith("20", StringComparison.Ordinal) ? "yyyyMMdd" : "ddMMyyyy";
            if (DateTime.TryParseExact(value, format, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var compact)) return compact.Date;
        }
        return DateTime.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AllowWhiteSpaces, out var parsed) ? parsed.Date : null;
    }
    static decimal? GstRate(XElement item)
    {
        var entries = item.Descendants().Where(x => x.Name.LocalName.Equals("GSTRATE", StringComparison.OrdinalIgnoreCase)).Select(rate => new
        {
            Rate = Number(rate.Value), Head = rate.Parent?.Elements().FirstOrDefault(s => s.Name.LocalName.Equals("GSTRATEDUTYHEAD", StringComparison.OrdinalIgnoreCase))?.Value ?? ""
        }).Where(x => x.Rate >= 0 && x.Rate <= 100).ToArray();
        var igst = entries.Where(x => x.Head.Contains("INTEGRATED", StringComparison.OrdinalIgnoreCase) || x.Head.Contains("IGST", StringComparison.OrdinalIgnoreCase)).Select(x => x.Rate).Distinct().ToArray();
        if (igst.Length == 1) return igst[0];
        if (igst.Length > 1) return null;
        var central = entries.Where(x => x.Head.Contains("CENTRAL", StringComparison.OrdinalIgnoreCase) || x.Head.Contains("CGST", StringComparison.OrdinalIgnoreCase)).Select(x => x.Rate).Distinct().ToArray();
        var state = entries.Where(x => x.Head.Contains("STATE", StringComparison.OrdinalIgnoreCase) || x.Head.Contains("SGST", StringComparison.OrdinalIgnoreCase) || x.Head.Contains("UTGST", StringComparison.OrdinalIgnoreCase)).Select(x => x.Rate).Distinct().ToArray();
        if (central.Length == 1 && state.Length == 1)
        {
            var total = central[0] + state[0];
            return total == 0 ? null : total;
        }
        var distinct = entries.Select(x => x.Rate).Distinct().ToArray();
        return distinct.Length == 1 && distinct[0] != 0 ? distinct[0] : null;
    }
    static string? HsnCode(XElement item)
    {
        var direct = Value(item, "HSNCODE", "GSTHSNCODE");
        if (direct.Length > 0) return direct;
        var match = System.Text.RegularExpressions.Regex.Match(Value(item, "HSNMASTERNAME"), @"(?<!\d)\d{4,8}(?!\d)");
        return match.Success ? match.Value : null;
    }
    static decimal? ClassificationRate(XElement item)
    {
        var match = System.Text.RegularExpressions.Regex.Match(Value(item, "HSNMASTERNAME"), @"(?<!\d)(\d{1,2}(?:\.\d+)?)\s*%");
        return match.Success && decimal.TryParse(match.Groups[1].Value, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var rate) && rate <= 100 ? rate : null;
    }
    public static XDocument Parse(string xml)
    {
        // Some Tally master fields contain legacy control bytes, sometimes emitted as numeric
        // character references. Both forms are illegal in XML 1.0; preserve all valid text.
        xml = System.Text.RegularExpressions.Regex.Replace(xml, @"&#(?:x([0-9a-fA-F]+)|([0-9]+));", match =>
        {
            var digits = match.Groups[1].Success ? match.Groups[1].Value : match.Groups[2].Value;
            var style = match.Groups[1].Success ? System.Globalization.NumberStyles.HexNumber : System.Globalization.NumberStyles.None;
            if (!int.TryParse(digits, style, System.Globalization.CultureInfo.InvariantCulture, out var codePoint)) return string.Empty;
            var validXml10 = codePoint is 0x9 or 0xA or 0xD || codePoint is >= 0x20 and <= 0xD7FF || codePoint is >= 0xE000 and <= 0xFFFD || codePoint is >= 0x10000 and <= 0x10FFFF;
            return validXml10 ? match.Value : string.Empty;
        });
        xml = new string(xml.Where(ch => ch is '\t' or '\n' or '\r' || ch >= '\u0020').ToArray());
        using var reader = XmlReader.Create(new StringReader(xml), new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 4 * 1024 * 1024 });
        return XDocument.Load(reader);
    }
}
record TallyItem(string NativeId, string Name, string Unit, decimal Balance, string? HsnCode, decimal? GstRate, string? Group, decimal? StandardSellingPrice = null, string? ClassificationName = null);
record TallyLedger(string NativeId, string Name, string? Group, string? Address, string? GstIn, string? StateName = null);
record TallyInvoiceLine(string Sku, string NativeId, string StockItemName, string Unit, decimal Quantity, decimal Rate, decimal DiscountPercent, decimal Amount, decimal GstRate, string HsnCode, decimal? BookBalance = null);
record TallyInvoicePayload(string JobId, string Company, string Environment, string VoucherType, string Date,
    string PartyLedgerName, string PartyState, string CompanyState, string SalesLedger, string CgstLedger, string SgstLedger,
    string IgstLedger, string ChargeLedger, string GodownName, string Reference, string Narration, string Terms, decimal Freight, decimal OtherCharges, TallyInvoiceLine[] Lines,
    decimal Taxable, decimal Cgst, decimal Sgst, decimal Igst, decimal Total);
record TallyInvoiceReadback(string Company, string VoucherType, string VoucherNumber, string Date, string Reference,
    string PartyLedgerName, TallyInvoiceLine[] Lines, decimal Taxable, decimal Cgst, decimal Sgst, decimal Igst, decimal Total);
// Durable boundary helper for the later validated posting adapter. A prepared operation can be cancelled;
// once Sending is journalled, every crash/lost response must reconcile, never recreate automatically.
record Attempt(string OperationId, string PayloadHash, string State, string? VoucherReference = null);
sealed class AttemptJournal(string directory)
{
    public void Write(Attempt attempt)
    {
        Directory.CreateDirectory(directory);
        if (!Guid.TryParse(attempt.OperationId, out _)) throw new InvalidOperationException("Invalid operation ID.");
        var path = Path.Combine(directory, attempt.OperationId + ".json");
        if (File.Exists(path))
        {
            var previous = JsonSerializer.Deserialize<Attempt>(File.ReadAllText(path))!;
            if (previous.PayloadHash != attempt.PayloadHash) throw new InvalidOperationException("Immutable payload hash mismatch.");
            var allowed = previous.State switch
            {
                "Prepared" => new[] { "Prepared", "Sending", "Rejected", "Confirmed", "NeedsReview" },
                "Sending" => new[] { "ConfirmationUnknown", "Confirmed", "Rejected", "NeedsReview" },
                "ConfirmationUnknown" => new[] { "Confirmed", "NeedsReview", "RetryAuthorized" },
                "RetryAuthorized" => new[] { "Sending", "ConfirmationUnknown", "Rejected", "Confirmed", "NeedsReview" },
                "Confirmed" => new[] { "Confirmed", "NeedsReview" },
                "Rejected" => new[] { "Rejected", "NeedsReview" },
                _ => new[] { "NeedsReview", "Confirmed" }
            };
            if (!allowed.Contains(attempt.State)) throw new InvalidOperationException("Unsafe posting transition blocked; reconcile instead of sending again.");
        }

        var tempPath = path + ".tmp";
        var bytes = JsonSerializer.SerializeToUtf8Bytes(attempt);
        using (var file = new FileStream(tempPath, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
        {
            file.Write(bytes);
            file.Flush(true);
        }

        // Security scanners and indexers can briefly deny replacement of the existing journal.
        // Retry that atomic replace; never delete the last known-good journal as a fallback.
        for (var attemptNumber = 0; ; attemptNumber++)
        {
            try
            {
                File.Move(tempPath, path, true);
                return;
            }
            catch (Exception ex) when (attemptNumber < 5 && ex is IOException or UnauthorizedAccessException)
            {
                Thread.Sleep(100 * (1 << attemptNumber));
            }
        }
    }
    public Attempt Read(string operationId) => JsonSerializer.Deserialize<Attempt>(File.ReadAllText(Path.Combine(directory, operationId + ".json")))!;
}
static class ConnectorTests
{
    public static void Run()
    {
        var passed = 0; void Test(string name, Action action) { action(); Console.WriteLine("PASS " + name); passed++; }
        void MustThrow(Action a) { try { a(); } catch (Exception e) when (e is InvalidOperationException or XmlException) { return; } throw new Exception("Expected rejection."); }
        Test("Test credentials require explicit diagnostics mode", () => { if (ConnectorMode.AllowsEnvironment("Test", false) || !ConnectorMode.AllowsEnvironment("Test", true) || ConnectorMode.AllowsEnvironment("Other", true)) throw new Exception("Environment policy failed"); });
        Test("Diagnostics and Test credentials cannot process accounting", () => { if (ConnectorMode.AllowsAccounting("Test", true) || ConnectorMode.AllowsAccounting("Production", true) || ConnectorMode.AllowsAccounting("Test", false) || !ConnectorMode.AllowsAccounting("Production", false)) throw new Exception("Accounting mode policy failed"); });
        Test("XML escaping and exact company", () => { var xml = TallyXml.Parse(TallyXml.CompanyProbe("TEST & <Company>")); if (xml.Descendants("SVCURRENTCOMPANY").Single().Value != "TEST & <Company>") throw new Exception("Escaping failed"); });
        Test("XXE/DTD rejected", () => MustThrow(() => TallyXml.Parse("<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///test'>]><x>&e;</x>")));
        var dir = Path.Combine(Path.GetTempPath(), "dispatch-journal-test-" + Guid.NewGuid().ToString("N")); var j = new AttemptJournal(dir); var id = Guid.NewGuid().ToString();
        Test("Sending journal survives reopen", () => { j.Write(new(id, "hash", "Prepared")); j.Write(new(id, "hash", "Sending")); if (new AttemptJournal(dir).Read(id).State != "Sending") throw new Exception("Journal lost"); });
        Test("Crash after send blocks blind recreate", () => MustThrow(() => j.Write(new(id, "hash", "Prepared"))));
        Test("Payload cannot mutate after attempt", () => MustThrow(() => j.Write(new(id, "different", "Sending"))));
        Test("ConfirmationUnknown requires reconciliation", () => { j.Write(new(id, "hash", "ConfirmationUnknown")); MustThrow(() => j.Write(new(id, "hash", "Prepared"))); });
        Test("Confirmed operation cannot be prepared again", () => { j.Write(new(id, "hash", "Confirmed", "demo-voucher")); MustThrow(() => j.Write(new(id, "hash", "Prepared"))); MustThrow(() => j.Write(new(id, "hash", "Sending"))); });
        Console.WriteLine($"{passed} connector fixture tests passed. No real Tally calls executed.");
    }
}
