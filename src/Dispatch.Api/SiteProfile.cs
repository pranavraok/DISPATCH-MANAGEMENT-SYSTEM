using Microsoft.EntityFrameworkCore;

namespace Dispatch;

public sealed record DeploymentScope(SiteProfile? Site, string? AromazenTallyCompany = null)
{
    public string? ExactTallyCompany => Site?.Slug == "aromazon" ? AromazenTallyCompany : Site?.Slug == "electro" ? "ELECTRO GROUP OF INDUSTRIES" : null;
    public string InvoicePattern => Site?.Slug == "aromazon" ? "AromazenGSTInvoiceV1" : "ElectroGSTInvoiceV1";
    public bool PostingSupported => Site != null && !string.IsNullOrWhiteSpace(ExactTallyCompany);
}

// Deployment-owned identity. Requests cannot select another company or workflow.
public sealed record SiteProfile(string Slug, string CompanyId, string CompanyName, string ShortName,
    string Tagline, string Email, string Workflow)
{
    public bool LocalPreview { get; init; }
    public static SiteProfile? From(IConfiguration config) => config["DispatchSite"] switch
    {
        null or "" => null, // Original engine is retained for local regression tests only.
        "electro" => new("electro", "demo", "Electro Group of Industries", "ELECTRO", "GROUP OF INDUSTRIES", "admin@electrogroup.test", Workflows.OrderFirst),
        "aromazon" => new("aromazon", "aromazon-india", "AROMAZEN PVT LTD", "AROMAZEN", "PVT LTD", "admin@aromazon.test", Workflows.StockFirst),
        _ => throw new InvalidOperationException("Unknown DispatchSite. Use electro or aromazon.")
    };

    public string Resolve(string? requested)
    {
        if (!string.IsNullOrEmpty(requested) && Workflows.Parse(requested) != Workflow)
            throw new RuleException("This workflow is not available on this company's website.", 409);
        return Workflow;
    }

    public async Task ValidateDatabase(DispatchDb db)
    {
        // Correct company display names without changing the company's identity or records.
        if (Slug == "aromazon")
            await db.Companies.Where(c => c.Id == CompanyId && c.Name == "Aromazon India Private Limited")
                .ExecuteUpdateAsync(update => update.SetProperty(c => c.Name, CompanyName));
        if (Slug == "electro")
        {
            await db.Companies.Where(c => c.Id == CompanyId)
                .ExecuteUpdateAsync(update => update.SetProperty(c => c.Environment, "Production"));
            await db.Connectors.Where(c => c.CompanyId == CompanyId && c.ExpectedCompany == "ELECTRO GROUP OF INDUSTRIES" && c.Environment == "Test")
                .ExecuteUpdateAsync(update => update.SetProperty(c => c.Environment, "Production").SetProperty(c => c.Name, "Electro Tally PC"));
            await db.Connectors.Where(c => c.CompanyId == CompanyId && c.ExpectedCompany == "ELECTRO GROUP OF INDUSTRIES" && c.Environment == "Production" && c.Name == "Tally test PC")
                .ExecuteUpdateAsync(update => update.SetProperty(c => c.Name, "Electro Tally PC"));
            await db.Mappings.Where(m => m.CompanyId == CompanyId && m.Pattern == "ElectroTestGSTInvoiceV1")
                .ExecuteUpdateAsync(update => update.SetProperty(m => m.Pattern, "ElectroGSTInvoiceV1"));
            await db.Users.Where(u => u.CompanyId == CompanyId && u.Name == "Trial Administrator")
                .ExecuteUpdateAsync(update => update.SetProperty(u => u.Name, "Electro Administrator"));
            await db.Manifests.Where(m => m.CompanyId == CompanyId && m.Name == "10-carton physical trial · Fictional")
                .ExecuteUpdateAsync(update => update.SetProperty(m => m.Name, "10-carton demo dispatch · Fictional"));
        }
        if (!await db.Companies.AnyAsync(c => c.Id == CompanyId && c.Name == CompanyName))
            throw new InvalidOperationException("The configured site does not match this database's company. Startup stopped.");
    }
}
