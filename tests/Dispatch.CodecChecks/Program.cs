using Dispatch;
using System.Security.Cryptography;

static void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
const string id = "CT-0123456789ABCDEF0123";
Check(CartonCodes.Encode(id, 1, "demo") == "QASNFZ4mrze8BIw.1", "Server/browser QR vector differs.");
var seen = new HashSet<string>();
for (var i = 0; i < 1000; i++)
{
    var identity = "CT-" + Convert.ToHexString(RandomNumberGenerator.GetBytes(10));
    var revision = i % 2 == 0 ? i + 1 : int.MaxValue;
    var qr = CartonCodes.Encode(identity, revision, "demo");
    Check(CartonCodes.TryDecode(qr, out var decoded, out var version) && decoded == identity && version == revision, "A compact QR changed identity or revision.");
    Check(seen.Add(qr), "Two different carton vectors produced the same QR.");
}
foreach (var invalid in new[] { "QAAAAAAAAAAAAAR.1", "QAAAAAAAAAAAAAQ.0", "QAAAAAAAAAAAAAQ.01", "QAAAAAAAAAAAAAQ.ZIK0ZK", "QASNFZ4mrze8BIw.-1", "QASNFZ4mrze8BIw.1|extra" })
    Check(!CartonCodes.TryDecode(invalid, out _, out _), "Malformed compact QR was accepted.");
Check(CartonCodes.Encode("CT-TEST", 1, "demo") == "K1|demo|CT-TEST|1", "Legacy identity fallback changed.");
Check(!CartonCodes.TryDecode("K1|demo|" + id + "|1", out _, out _), "Legacy QR should use the existing company-scoped resolver.");
Console.WriteLine("PASS compact QR: cross-language vector, 1,000 full-identity/revision round trips, malformed codes and legacy fallback.");
