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
if (args.Contains("--self-test")) { ConnectorTests.Run(); return; }
if (args.Contains("--pair"))
{
    if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Pairing uses Windows DPAPI.");
    Directory.CreateDirectory(folder); Console.Write("Cloud HTTPS URL: "); var cloud = Console.ReadLine()!.Trim(); if (!Uri.TryCreate(cloud, UriKind.Absolute, out var uri) || uri.Scheme != "https") throw new InvalidOperationException("HTTPS required.");
    Console.Write("Connector ID: "); var id = Console.ReadLine()!.Trim(); Console.Write("Exact isolated Tally TEST company: "); var company = Console.ReadLine()!.Trim(); Console.Write("Tally loopback endpoint [http://127.0.0.1:9000]: "); var endpoint = Console.ReadLine(); endpoint = string.IsNullOrWhiteSpace(endpoint) ? "http://127.0.0.1:9000" : endpoint.Trim(); if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var tally) || !tally.IsLoopback) throw new InvalidOperationException("This stage permits loopback Tally only. A restricted LAN policy needs explicit implementation.");
    Console.Write("Pairing key (hidden): "); var secret = new StringBuilder(); ConsoleKeyInfo key; while ((key = Console.ReadKey(true)).Key != ConsoleKey.Enter) { if (key.Key == ConsoleKey.Backspace) { if (secret.Length > 0) secret.Length--; } else if (!char.IsControl(key.KeyChar)) secret.Append(key.KeyChar); }
    Console.WriteLine(); if (secret.Length != 64) throw new InvalidOperationException("Pairing key must be 64 hex characters.");
    var config = new ConnectorConfig(cloud, id, company, "Test", endpoint); await File.WriteAllTextAsync(Path.Combine(folder, "config.json"), JsonSerializer.Serialize(config)); await File.WriteAllBytesAsync(Path.Combine(folder, "credential.dpapi"), ProtectedData.Protect(Encoding.UTF8.GetBytes(secret.ToString()), null, DataProtectionScope.CurrentUser)); Console.WriteLine("Paired for diagnostics. No voucher posting enabled."); return;
}
var builder = Host.CreateApplicationBuilder(args); builder.Services.AddWindowsService(o => o.ServiceName = "Electro Group Dispatch Connector"); builder.Services.AddSingleton(new ConnectorStorage(folder)); builder.Services.AddHostedService<ConnectorWorker>(); await builder.Build().RunAsync();

record ConnectorConfig(string Cloud, string ConnectorId, string Company, string Environment, string TallyEndpoint);
record ConnectorStorage(string Folder);
sealed class ConnectorWorker(ConnectorStorage storage, ILogger<ConnectorWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!OperatingSystem.IsWindows()) { logger.LogError("Run this connector on the separate Windows Tally computer."); return; }
        var config = JsonSerializer.Deserialize<ConnectorConfig>(await File.ReadAllTextAsync(Path.Combine(storage.Folder, "config.json"), stoppingToken))!;
        if (new Uri(config.Cloud).Scheme != "https" || !new Uri(config.TallyEndpoint).IsLoopback || config.Environment != "Test") throw new InvalidOperationException("Connector environment policy failed.");
        var secret = Encoding.UTF8.GetString(ProtectedData.Unprotect(await File.ReadAllBytesAsync(Path.Combine(storage.Folder, "credential.dpapi"), stoppingToken), null, DataProtectionScope.CurrentUser));
        using var processLock = new FileStream(Path.Combine(storage.Folder, "connector.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        using var cloud = new HttpClient { BaseAddress = new Uri(config.Cloud), Timeout = TimeSpan.FromSeconds(20) }; cloud.DefaultRequestHeaders.Add("X-Connector-Id", config.ConnectorId); cloud.DefaultRequestHeaders.Add("X-Connector-Key", secret);
        using var tally = new HttpClient { Timeout = TimeSpan.FromSeconds(10), MaxResponseContentBufferSize = 4 * 1024 * 1024 }; var failures = 0;
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                var reachable = false; var detail = ""; try
                {
                    using var response = await tally.PostAsync(config.TallyEndpoint, new StringContent(TallyXml.CompanyProbe(config.Company), Encoding.UTF8, "text/xml"), stoppingToken); response.EnsureSuccessStatusCode(); var xml = TallyXml.Parse(await response.Content.ReadAsStringAsync(stoppingToken));
                    var names = xml.Descendants("COMPANY").Select(x => (string?)x.Attribute("NAME") ?? (string?)x.Element("NAME")).Where(x => x != null).ToArray(); reachable = names.Contains(config.Company, StringComparer.Ordinal); detail = reachable ? "Exact expected company found. Installation version, GUID, stock mappings and posting/readback still require validation." : "Expected company not exported. Open the exact test company and check integration permissions/port.";
                }
                catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or XmlException) { detail = "Tally is stopped, integration unavailable, response unsafe or endpoint timed out. No accounting request was sent."; }
                try { using var reply = await cloud.PostAsJsonAsync("/api/connector/heartbeat", new { company = config.Company, environment = config.Environment, tallyReachable = reachable, version = "Unknown", detail }, stoppingToken); reply.EnsureSuccessStatusCode(); failures = 0; logger.LogInformation("Heartbeat delivered. Tally reachable={Reachable}. Posting disabled.", reachable); } catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException) { failures = Math.Min(failures + 1, 5); logger.LogWarning("Cloud heartbeat failed. Reconnecting with bounded backoff."); }
                await Task.Delay(TimeSpan.FromSeconds(Math.Min(120, 15 * Math.Pow(2, failures))), stoppingToken);
            }
        }
        finally { processLock.Flush(true); }
    }
}
static class TallyXml
{
    public static string CompanyProbe(string company) => new XDocument(new XElement("ENVELOPE", new XElement("HEADER", new XElement("VERSION", 1), new XElement("TALLYREQUEST", "Export"), new XElement("TYPE", "Collection"), new XElement("ID", "ElectroGroupCompanyProbe")), new XElement("BODY", new XElement("DESC", new XElement("STATICVARIABLES", new XElement("SVCURRENTCOMPANY", company), new XElement("SVEXPORTFORMAT", "$$SysName:XML")), new XElement("TDL", new XElement("TDLMESSAGE", new XElement("COLLECTION", new XAttribute("NAME", "ElectroGroupCompanyProbe"), new XElement("TYPE", "Company"), new XElement("FETCH", "Name,GUID")))))))).ToString(SaveOptions.DisableFormatting);
    public static XDocument Parse(string xml) { using var reader = XmlReader.Create(new StringReader(xml), new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 4 * 1024 * 1024 }); return XDocument.Load(reader); }
}
// Durable boundary helper for the later validated posting adapter. A prepared operation can be cancelled;
// once Sending is journalled, every crash/lost response must reconcile, never recreate automatically.
record Attempt(string OperationId, string PayloadHash, string State, string? VoucherReference = null);
sealed class AttemptJournal(string directory)
{
    public void Write(Attempt attempt) { Directory.CreateDirectory(directory); if (!Guid.TryParse(attempt.OperationId, out _)) throw new InvalidOperationException("Invalid operation ID."); var path = Path.Combine(directory, attempt.OperationId + ".json"); if (File.Exists(path)) { var previous = JsonSerializer.Deserialize<Attempt>(File.ReadAllText(path))!; if (previous.PayloadHash != attempt.PayloadHash) throw new InvalidOperationException("Immutable payload hash mismatch."); var allowed = previous.State switch { "Prepared" => new[] { "Prepared", "Sending", "Rejected" }, "Sending" => new[] { "ConfirmationUnknown", "Confirmed", "Rejected", "NeedsReview" }, "ConfirmationUnknown" => new[] { "Confirmed", "NeedsReview" }, "Confirmed" => new[] { "Confirmed", "NeedsReview" }, "Rejected" => new[] { "Rejected", "NeedsReview" }, _ => new[] { "NeedsReview", "Confirmed" } }; if (!allowed.Contains(attempt.State)) throw new InvalidOperationException("Unsafe posting transition blocked; reconcile instead of sending again."); } var bytes = JsonSerializer.SerializeToUtf8Bytes(attempt); using (var file = new FileStream(path + ".tmp", FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough)) { file.Write(bytes); file.Flush(true); } File.Move(path + ".tmp", path, true); }
    public Attempt Read(string operationId) => JsonSerializer.Deserialize<Attempt>(File.ReadAllText(Path.Combine(directory, operationId + ".json")))!;
}
static class ConnectorTests
{
    public static void Run()
    {
        var passed = 0; void Test(string name, Action action) { action(); Console.WriteLine("PASS " + name); passed++; }
        void MustThrow(Action a) { try { a(); } catch (Exception e) when (e is InvalidOperationException or XmlException) { return; } throw new Exception("Expected rejection."); }
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
