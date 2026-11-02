using Microsoft.EntityFrameworkCore;

namespace Dispatch;

public sealed record TallyMasterSyncResult(int AddedProducts, int UpdatedProducts, int AddedCustomers, int UpdatedCustomers, int ProductCount, int CustomerCount);

public static class TallyMasterSync
{
    static bool IsTrialAddress(string? address) =>
        !string.IsNullOrWhiteSpace(address) &&
        (address.Contains("Fictional address for dispatch trial", StringComparison.OrdinalIgnoreCase) ||
         address.Contains("Fictional dispatch trial customer", StringComparison.OrdinalIgnoreCase));

    public static async Task<TallyMasterSyncResult> Apply(DispatchDb db, string companyId, TallyMasterSnapshot snapshot)
    {
        if (snapshot.Items.Length > 500 || snapshot.Ledgers.Length > 1000)
            throw new RuleException("The Tally master list exceeds the import limit.");

        var addedProducts = 0;
        var updatedProducts = 0;
        var addedCustomers = 0;
        var updatedCustomers = 0;
        var presentProductIds = new HashSet<string>(StringComparer.Ordinal);
        var presentCustomerIds = new HashSet<string>(StringComparer.Ordinal);
        var customerLedgers = snapshot.Ledgers.Where(x => !string.IsNullOrWhiteSpace(x.NativeId)
            && !string.IsNullOrWhiteSpace(x.Name)
            && string.Equals(x.Group, "Sundry Debtors", StringComparison.OrdinalIgnoreCase)).ToArray();
        if (customerLedgers.Length == 0)
            throw new RuleException("Tally did not return any Sundry Debtors. The previous customer list was kept; no customer was deactivated.", 409);

        foreach (var item in snapshot.Items.Where(x => !string.IsNullOrWhiteSpace(x.NativeId) && !string.IsNullOrWhiteSpace(x.Name)))
        {
            var name = item.Name.Trim();
            var normalizedName = name.ToLowerInvariant();
            var product = await db.Products.FirstOrDefaultAsync(x => x.CompanyId == companyId && x.TallyId == item.NativeId)
                ?? await db.Products.FirstOrDefaultAsync(x => x.CompanyId == companyId && ((x.TallyName != null && x.TallyName.ToLower() == normalizedName) || x.Name.ToLower() == normalizedName));

            if (product == null)
            {
                var sku = await NewSku(db, companyId, name, item.NativeId);
                product = new Product { CompanyId = companyId, Sku = sku, Unit = string.IsNullOrWhiteSpace(item.Unit) ? "Nos" : item.Unit.Trim() };
                db.Products.Add(product);
                addedProducts++;
            }
            else updatedProducts++;

            // Tally is the master source. Operational carton contents are separate snapshots, so a Tally unit/name edit
            // updates future work without rewriting any already-packed or shipped records.
            product.Name = name;
            product.TallyName = name;
            product.TallyId = item.NativeId;
            product.TallyGroup = item.Group;
            if (!string.IsNullOrWhiteSpace(item.Unit)) product.Unit = item.Unit.Trim();
            product.HsnCode = string.IsNullOrWhiteSpace(item.HsnCode) ? null : item.HsnCode.Trim();
            product.GstRate = item.GstRate;
            product.TallySellingPrice = item.StandardSellingPrice;
            product.BookBalance = item.Balance;
            product.SyncedAt = DateTimeOffset.UtcNow;
            product.InTally = true;
            presentProductIds.Add(product.Id);
        }

        // Keep old records for order and invoice history, but stop offering masters
        // that are absent from this successful full Tally snapshot.
        var priorProducts = await db.Products.Where(x => x.CompanyId == companyId && x.InTally).ToListAsync();
        foreach (var product in priorProducts)
            if (!presentProductIds.Contains(product.Id)) product.InTally = false;

        var syncedTallyIds = snapshot.Items.Select(x => x.NativeId).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var archivedDemoProducts = await db.Products.Where(x => x.CompanyId == companyId && x.TallyId != null
            && x.TallyName != null && x.TallyName.StartsWith("DEMO -") && !syncedTallyIds.Contains(x.TallyId))
            .ToListAsync();
        foreach (var product in archivedDemoProducts)
        {
            var originalName = (product.TallyName ?? product.Name).Replace("DEMO -", "", StringComparison.OrdinalIgnoreCase).Trim();
            product.Name = "ARCHIVE - UNUSED - " + originalName;
            product.TallyName = product.Name;
            product.HsnCode = null;
            product.GstRate = null;
            product.TallySellingPrice = null;
            product.BookBalance = null;
            product.SyncedAt = DateTimeOffset.UtcNow;
        }

        foreach (var ledger in customerLedgers)
        {
            var name = ledger.Name.Trim();
            var normalizedName = name.ToLowerInvariant();
            var customer = await db.Customers.FirstOrDefaultAsync(x => x.CompanyId == companyId && x.TallyId == ledger.NativeId)
                ?? await db.Customers.FirstOrDefaultAsync(x => x.CompanyId == companyId && x.Name.ToLower() == normalizedName);

            if (customer == null)
            {
                customer = new Customer { CompanyId = companyId };
                db.Customers.Add(customer);
                addedCustomers++;
            }
            else updatedCustomers++;

            customer.Name = name;
            customer.TallyId = ledger.NativeId;
            customer.TallyGroup = ledger.Group;
            var tallyAddress = ledger.Address?.Trim() ?? "";
            var tallyState = ledger.StateName?.Trim() ?? "";
            if (tallyState.Length > 0 && !tallyAddress.Contains(tallyState, StringComparison.OrdinalIgnoreCase))
                tallyAddress = tallyAddress.Length == 0 ? tallyState : $"{tallyAddress}, {tallyState}";
            // Never present the old sample address as a customer's real delivery address.
            customer.TallyAddress = tallyAddress.Length == 0 || IsTrialAddress(tallyAddress) ? null : tallyAddress;
            customer.GstIn = string.IsNullOrWhiteSpace(ledger.GstIn) ? null : ledger.GstIn.Trim();
            customer.InTally = true;
            presentCustomerIds.Add(customer.Id);
        }

        var priorCustomers = await db.Customers.Where(x => x.CompanyId == companyId && x.InTally).ToListAsync();
        foreach (var customer in priorCustomers)
            if (!presentCustomerIds.Contains(customer.Id)) customer.InTally = false;

        return new TallyMasterSyncResult(addedProducts, updatedProducts, addedCustomers, updatedCustomers,
            snapshot.Items.Count(x => !string.IsNullOrWhiteSpace(x.NativeId) && !string.IsNullOrWhiteSpace(x.Name)),
            snapshot.Ledgers.Count(x => !string.IsNullOrWhiteSpace(x.NativeId) && !string.IsNullOrWhiteSpace(x.Name) && string.Equals(x.Group, "Sundry Debtors", StringComparison.OrdinalIgnoreCase)));
    }

    static async Task<string> NewSku(DispatchDb db, string companyId, string name, string nativeId)
    {
        var compact = new string(name.Where(c => char.IsLetterOrDigit(c) || c is '-' or '_').ToArray());
        if (compact.Length == 0) compact = "TALLYITEM";
        var suffix = nativeId.Length >= 6 ? nativeId[..6].ToUpperInvariant() : Guid.NewGuid().ToString("N")[..6].ToUpperInvariant();
        var candidate = compact.Length <= 43 ? compact + "-" + suffix : compact[..43] + "-" + suffix;
        if (!await db.Products.AnyAsync(x => x.CompanyId == companyId && x.Sku == candidate)) return candidate;
        return "T-" + Guid.NewGuid().ToString("N")[..16].ToUpperInvariant();
    }
}
