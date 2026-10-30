using System.Text.RegularExpressions;

namespace Dispatch;

public static class CartonCodes
{
    static string Token(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    static string Base36(int value)
    {
        const string alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        var result = "";
        do { result = alphabet[value % 36] + result; value /= 36; } while (value > 0);
        return result;
    }
    public static string Encode(string id, int revision, string company)
    {
        if (revision < 1) throw new ArgumentOutOfRangeException(nameof(revision));
        return Regex.IsMatch(id, "^CT-[0-9A-F]{20}$")
            ? "Q" + Token(Convert.FromHexString(id[3..])) + "." + Base36(revision)
            : $"K1|{company}|{id}|{revision}";
    }
    public static bool TryDecode(string qr, out string id, out int revision)
    {
        id = ""; revision = 0;
        var match = Regex.Match(qr, @"^Q([A-Za-z0-9_-]{14})\.([0-9A-Z]{1,6})$");
        if (!match.Success) return false;
        byte[] bytes;
        try { bytes = Convert.FromBase64String(match.Groups[1].Value.Replace('-', '+').Replace('_', '/') + "=="); }
        catch (FormatException) { return false; }
        if (bytes.Length != 10 || Token(bytes) != match.Groups[1].Value) return false;
        long value = 0;
        foreach (var c in match.Groups[2].Value) value = value * 36 + (c <= '9' ? c - '0' : c - 'A' + 10);
        if (value < 1 || value > int.MaxValue || Base36((int)value) != match.Groups[2].Value) return false;
        id = "CT-" + Convert.ToHexString(bytes); revision = (int)value;
        return true;
    }
}
