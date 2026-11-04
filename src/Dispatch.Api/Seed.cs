using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
namespace Dispatch;

public static class Seed
{
    public static async Task Run(DispatchDb db, IConfiguration config)
    {
        var password = config["BootstrapPassword"]; if (await db.Companies.AnyAsync()) return;
        if (string.IsNullOrWhiteSpace(password) || password.Length < 12) throw new InvalidOperationException("Set BootstrapPassword to at least 12 characters before initial migration/seed.");
        var site = SiteProfile.From(config); var companyId = site?.CompanyId ?? "demo";
        await using var tx = await db.Database.BeginTransactionAsync(); db.Companies.Add(new Company { Id = companyId, Name = site?.CompanyName ?? "Electro Group of Industries" }); db.Warehouses.Add(new Warehouse { Id = "main", CompanyId = companyId }); db.Mappings.Add(new Mapping { Id = "mapping", CompanyId = companyId });
        if (site == null) {
        db.Products.AddRange(new Product { Id = "sandal", Sku = "SND01", Name = "Sample item A" }, new Product { Id = "rose", Sku = "ROS01", Name = "Sample item B" }); db.Customers.AddRange(new Customer { Id = "ravi", Name = "Ravi Stores · Demo", Address = "Mysuru, Karnataka" }, new Customer { Id = "meena", Name = "Meena Traders · Demo", Address = "Bengaluru, Karnataka" });
        }
        var admin = new User { Id = "admin", CompanyId = companyId, Name = site?.Slug == "aromazon" ? "AROMAZEN Administrator" : "Electro Administrator", Email = config["BootstrapEmail"] ?? site?.Email ?? "admin@electrogroup.test", Roles = ["Admin", "PackingClerk", "PackingSupervisor", "Loader", "DispatchSupervisor", "Billing"] }; admin.PasswordHash = new PasswordHasher<User>().HashPassword(admin, password); db.Users.Add(admin);
        var md = new User { Id = "md", CompanyId = companyId, Name = "Managing Director", Email = site?.Slug == "aromazon" ? "md@aromazon.test" : "md@electrogroup.test", Roles = ["MD"] }; md.PasswordHash = new PasswordHasher<User>().HashPassword(md, config["BootstrapMdPassword"] ?? Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(24))); db.Users.Add(md);
        if (site == null) {
        AddFixture(db, "DEMO-50", [new("A", 20, [new("SND01", 100, "packets")]), new("B", 15, [new("SND01", 80, "packets")]), new("C", 10, [new("ROS01", 100, "packets")]), new("D", 5, [new("SND01", 40, "packets"), new("ROS01", 20, "packets")])]);
        AddFixture(db, "TRIAL-10", [new("A", 4, [new("SND01", 100, "packets")]), new("B", 3, [new("SND01", 80, "packets")]), new("C", 2, [new("ROS01", 100, "packets")]), new("D", 1, [new("SND01", 40, "packets"), new("ROS01", 20, "packets")])]);
        }
        await db.SaveChangesAsync(); await tx.CommitAsync();
    }
    static void AddFixture(DispatchDb db, string id, PackedGroup[] groups)
    {
        db.Manifests.Add(new Manifest { Id = id, Name = id == "DEMO-50" ? "50-carton reference · Fictional" : "10-carton demo dispatch · Fictional", Groups = Json.Write(groups), Notes = "Fictional reference. Draft only: supervisor must check actual physical boxes before approval." });
    }
}
