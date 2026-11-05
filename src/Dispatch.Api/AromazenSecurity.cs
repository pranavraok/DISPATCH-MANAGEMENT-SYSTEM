using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
namespace Dispatch;

public sealed class AromazenQrRow
{
    public string CartonId { get; set; } = "";
    public int Revision { get; set; }
}
public static class AromazenSecurity
{
    public static string RandomToken(int bytes = 32) => Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes)).TrimEnd('=').Replace('+','-').Replace('/','_');
}

public sealed partial class Operations
{
    string? dispatchSession;
    async Task<string> SecureCartonQr(Carton carton)
    {
        var token = await db.Database.SqlQuery<string>($"""SELECT "Token" AS "Value" FROM "AromazenQrLabels" WHERE "CompanyId"={company} AND "CartonId"={carton.Id} AND "Revision"={carton.Revision}""").SingleOrDefaultAsync();
        if (token == null) {
            token = AromazenSecurity.RandomToken(16);
            await db.Database.ExecuteSqlInterpolatedAsync($"""INSERT INTO "AromazenQrLabels" ("Token","CompanyId","CartonId","Revision") VALUES ({token},{company},{carton.Id},{carton.Revision})""");
        }
        var secret = await QrKey();
        var signature = Convert.ToHexString(HMACSHA256.HashData(Convert.FromBase64String(secret), Encoding.UTF8.GetBytes(company+"|"+token)))[..32];
        return "AZ2."+token+"."+signature;
    }
    async Task<string> QrKey()
    {
        var key = await db.Database.SqlQuery<string>($"""SELECT "Secret" AS "Value" FROM "AromazenQrKeys" WHERE "CompanyId"={company}""").SingleOrDefaultAsync();
        if (key != null) return key;
        key=Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        await db.Database.ExecuteSqlInterpolatedAsync($"""INSERT INTO "AromazenQrKeys" ("CompanyId","Secret") VALUES ({company},{key}) ON CONFLICT ("CompanyId") DO NOTHING""");
        return await db.Database.SqlQuery<string>($"""SELECT "Secret" AS "Value" FROM "AromazenQrKeys" WHERE "CompanyId"={company}""").SingleAsync();
    }
    async Task CheckLegacyLabel(Carton carton)
    {
        if (!Aromazen) return;
        var secure = await db.Database.SqlQuery<int>($"""SELECT count(*)::int AS "Value" FROM "AromazenQrLabels" WHERE "CompanyId"={company} AND "CartonId"={carton.Id} AND "Revision"={carton.Revision}""").SingleAsync();
        Check(secure == 0, "This carton has a signed label. Scan its current signed QR instead of an older or manually constructed code.");
    }
    async Task<Carton> ResolveSecureQr(string qr)
    {
        var parts=qr.Split('.');
        Check(parts.Length == 3 && parts[0]=="AZ2" && parts[1].Length==22 && parts[2].Length==32 && parts[2].All(Uri.IsHexDigit), "Invalid signed carton QR.");
        var key=await db.Database.SqlQuery<string>($"""SELECT "Secret" AS "Value" FROM "AromazenQrKeys" WHERE "CompanyId"={company}""").SingleOrDefaultAsync();
        Check(key != null, "Invalid or wrong-company carton QR.");
        var expected=HMACSHA256.HashData(Convert.FromBase64String(key!), Encoding.UTF8.GetBytes(company+"|"+parts[1]));
        Check(CryptographicOperations.FixedTimeEquals(expected[..16],Convert.FromHexString(parts[2])), "Altered or wrong-company carton QR.");
        var row=await db.Database.SqlQuery<AromazenQrRow>($"""SELECT "CartonId","Revision" FROM "AromazenQrLabels" WHERE "CompanyId"={company} AND "Token"={parts[1]}""").SingleOrDefaultAsync();
        Check(row != null, "Carton label unavailable.");
        var carton=await Get<Carton>(row!.CartonId);
        Check(carton.Revision==row.Revision,"Obsolete label revision. Scan the current attached label.");
        return carton;
    }
}
